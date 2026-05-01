import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../logger";
import { fetchPublicMatches, fetchPlayerStatsForRosters } from "./edgeApi";
import { getActiveEvent, getActiveTeam } from "./database";
import { QUESTION_CATEGORIES, pickCategoryForDay } from "./questionCategories";

// ─── Constants ────────────────────────────────────────────────────────────────

const PUBLIC_MATCHES_PAGE_SIZE = 50;
const PUBLIC_MATCHES_DATE_WINDOW_DAYS = 30;
const PUBLIC_MATCHES_MAX_RANDOM_PAGE = 3;

function isoUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function getDayIndex() {
  return Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TriviaQuestion {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correct: string;
  explanation: string;
  difficulty: string;
  source: string;
  category: string;
}

// ─── EDGE data fetch ──────────────────────────────────────────────────────────

async function fetchEdgeData(): Promise<{
  edgeData: unknown;
  eventName: string | null;
  teamName: string | null;
} | null> {
  if (!process.env.EDGE_API_TOKEN) return null;

  const [activeEvent, activeTeam] = await Promise.all([getActiveEvent(), getActiveTeam()]);

  let after: string | undefined;
  let before: string | undefined;
  let pageNumber = 1;

  if (!activeEvent) {
    const now = new Date();
    const windowStart = new Date(now.getTime() - PUBLIC_MATCHES_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    after = isoUtc(windowStart);
    before = isoUtc(now);
    pageNumber = Math.ceil(Math.random() * PUBLIC_MATCHES_MAX_RANDOM_PAGE);
  }

  try {
    const publicMatches = await fetchPublicMatches(PUBLIC_MATCHES_PAGE_SIZE, pageNumber, after, before);

    // Apply team filter if set — keep only matches involving the active team
    const teamFiltered = activeTeam
      ? publicMatches.filter(
          (m) =>
            m.rosterLeft.name.toLowerCase() === activeTeam.toLowerCase() ||
            m.rosterRight.name.toLowerCase() === activeTeam.toLowerCase()
        )
      : publicMatches;

    const matchesWithGames = teamFiltered.filter((m) => m.matches.length > 0);

    if (matchesWithGames.length === 0) {
      logger.warn({ pageNumber, activeTeam }, "No matching matches with game data, falling back to wiki.");
      return null;
    }

    const selected = matchesWithGames[Math.floor(Math.random() * matchesWithGames.length)];

    // Fetch player stats for BOTH rosters in parallel so Claude can compare
    // players across teams (e.g. for top fragger, entry kills, KAST leader).
    const playerStats = await fetchPlayerStatsForRosters(
      selected.rosterLeft.steamIds,
      selected.rosterRight.steamIds,
      activeEvent
    );

    const edgeData = {
      match: {
        playedAt: selected.playedAt,
        teamLeft: selected.rosterLeft.name,
        teamRight: selected.rosterRight.name,
        results: selected.matches,
      },
      playerStats: {
        [selected.rosterLeft.name]: playerStats.left,
        [selected.rosterRight.name]: playerStats.right,
      },
    };

    logger.info(
      {
        teamLeft: selected.rosterLeft.name,
        teamRight: selected.rosterRight.name,
        gameCount: selected.matches.length,
        playedAt: selected.playedAt,
        pageNumber,
        after,
        before,
        activeEvent,
      },
      "EDGE API data fetched for both rosters"
    );

    return { edgeData, eventName: activeEvent, teamName: activeTeam };
  } catch (err) {
    logger.warn({ err }, "EDGE API fetch failed, falling back to wiki.");
    return null;
  }
}

// ─── Prompt assembly ──────────────────────────────────────────────────────────

function buildUserMessage(
  edgeResult: { edgeData: unknown; eventName: string | null; teamName: string | null } | null,
  dayIndex: number
): string {
  const hasEdgeData = edgeResult !== null;
  const category = pickCategoryForDay(dayIndex, hasEdgeData);

  if (edgeResult) {
    const { edgeData, eventName, teamName } = edgeResult;
    const scopeParts: string[] = [];
    if (eventName) scopeParts.push(eventName);
    if (teamName) scopeParts.push(`featuring ${teamName}`);
    const scopeLabel = scopeParts.length > 0 ? `from ${scopeParts.join(" ")}` : "from recent public CS2 matches";

    return `Today's question category: **${category.label}**

Category instructions:
${category.prompt}

Live CS2 data from the Skybox EDGE API (${scopeLabel}):
${JSON.stringify(edgeData, null, 2)}

Use the live data above to generate the question according to the category instructions.
Set "source" to "edge" and "category" to "${category.id}" in your response.`;
  }

  // Wiki fallback — pick from wiki-only categories
  const wikiCategories = QUESTION_CATEGORIES.filter((c) => !c.requiresEdgeData);
  const wikiCategory = wikiCategories[dayIndex % wikiCategories.length];

  return `Today's question category: **${wikiCategory.label}**

${wikiCategory.prompt}

Use your knowledge of CS2, the Counter-Strike wiki, and pro esports to generate one accurate trivia question.
Set "source" to "wiki" and "category" to "${wikiCategory.id}" in your response.`;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a CS2 esports trivia bot for a pro team fan Discord server.
Your job is to generate one fun, accurate multiple choice trivia question per day.

Your response must be valid JSON matching this exact structure:
{
  "question": "The question text",
  "options": {
    "A": "First option",
    "B": "Second option",
    "C": "Third option",
    "D": "Fourth option"
  },
  "correct": "A",
  "explanation": "Brief explanation of why the answer is correct",
  "difficulty": "easy|medium|hard",
  "source": "edge|wiki",
  "category": "top_fragger|map_result|entry_specialist|kast_leader|damage_dealer|headshot_rate|series_score|maps_played|weapons|maps|pro_players|tournaments|game_mechanics"
}

Rules:
- Questions must be factually accurate and verifiable from the data provided
- All four options must be plausible (avoid obviously wrong answers)
- The correct answer should be clearly correct, not ambiguous
- Keep questions engaging and relevant to CS2 esports fans
- Difficulty: easy = general knowledge, medium = knowledgeable fan, hard = expert level
- Do NOT include markdown, code blocks, or extra text — pure JSON only`;

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateDailyQuestion(): Promise<TriviaQuestion> {
  const dayIndex = getDayIndex();
  const edgeResult = await fetchEdgeData();
  const userMessage = buildUserMessage(edgeResult, dayIndex);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude did not return a text response");
  }
  let finalText = textBlock.text.trim();

  finalText = finalText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  const jsonMatch = finalText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Claude response did not contain a JSON object. Got: ${finalText.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as TriviaQuestion;
  return parsed;
}
