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

export interface QuestionOverrides {
  eventOverride?: string | null;
  teamOverride?: string | null;
  categoryOverride?: string | null;
}

// ─── EDGE data fetch ──────────────────────────────────────────────────────────

async function fetchEdgeData(overrides?: QuestionOverrides): Promise<{
  edgeData: unknown;
  eventName: string | null;
  teamName: string | null;
} | null> {
  if (!process.env.EDGE_API_TOKEN) return null;

  const [globalEvent, globalTeam] = await Promise.all([getActiveEvent(), getActiveTeam()]);
  // Override wins; fall back to global setting
  const activeEvent = overrides?.eventOverride !== undefined ? overrides.eventOverride : globalEvent;
  const activeTeam = overrides?.teamOverride !== undefined ? overrides.teamOverride : globalTeam;

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
  dayIndex: number,
  overrides?: QuestionOverrides
): string {
  const hasEdgeData = edgeResult !== null;

  // If a category override is given, find that exact category; otherwise pick for the day
  let category = pickCategoryForDay(dayIndex, hasEdgeData);
  if (overrides?.categoryOverride) {
    const found = QUESTION_CATEGORIES.find((c) => c.id === overrides.categoryOverride);
    if (found) category = found;
  }

  if (edgeResult) {
    const { edgeData, eventName, teamName } = edgeResult;
    const scopeParts: string[] = [];
    if (eventName) scopeParts.push(eventName);
    if (teamName) scopeParts.push(`featuring ${teamName}`);
    const scopeLabel = scopeParts.length > 0 ? `from ${scopeParts.join(" ")}` : "from recent public CS2 matches";

    return `Live CS2 match data from the Skybox EDGE API (${scopeLabel}):
${JSON.stringify(edgeData, null, 2)}

---
MANDATORY REQUIREMENTS — read before generating the question:
1. Your question MUST be answerable ONLY by reading the data above. If someone without the data could answer it, you have failed.
2. Every player name used in the question or as an answer option MUST come from "playerHandles" in the data above. Do NOT invent or recall player names from memory.
3. Every stat or score used MUST be the exact value from the data above. Do NOT estimate, round, or recall from memory.
4. The correct answer and all three wrong answers must be drawn from real values in the data (real player handles, real scores, real map names).
5. Do NOT ask conceptual, definitional, or historical questions. Do NOT ask what a metric means. Do NOT ask who is "known as" or "regarded as" anything.
6. Set "source" to "edge" and "category" to "${category.id}" in your response.

Today's question category: **${category.label}**
${category.prompt}`;
  }

  // Wiki fallback — pick from wiki-only categories (or honour category override if it's a wiki category)
  let wikiCategory = category;
  if (!overrides?.categoryOverride || category.requiresEdgeData) {
    const wikiCategories = QUESTION_CATEGORIES.filter((c) => !c.requiresEdgeData);
    wikiCategory = wikiCategories[dayIndex % wikiCategories.length];
  }

  return `Today's question category: **${wikiCategory.label}**

${wikiCategory.prompt}

Generate one specific, factual CS2 trivia question using your knowledge. The correct answer must be a verifiable fact — not an opinion or a vague claim.
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
- Do NOT include markdown, code blocks, or extra text — pure JSON only

CRITICAL — when live match data is provided:
- You MUST base the question directly on the numbers, player names, and outcomes in the data
- Do NOT generate a general knowledge or historical question when live data is present
- Do NOT ask vague questions like "who is widely regarded as..." — ask about the specific match stats given
- The question must be answerable solely from the data provided (e.g. "In this match, who had the most kills?")
- Every wrong option must also be a real player name or real value drawn from the data — no invented plausible-sounding names
- Set "source" to "edge" whenever live match data was provided to you, regardless of what the question looks like`;

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateDailyQuestion(overrides?: QuestionOverrides): Promise<TriviaQuestion> {
  const dayIndex = getDayIndex();
  const edgeResult = await fetchEdgeData(overrides);
  const userMessage = buildUserMessage(edgeResult, dayIndex, overrides);

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

  // Override source based on what the code actually did — if edgeResult was
  // non-null we sent live data to Claude, so the question is always "edge"
  // regardless of what Claude self-reported. Prevents the "wiki" mislabel.
  if (edgeResult !== null) {
    parsed.source = "edge";
  }

  return parsed;
}
