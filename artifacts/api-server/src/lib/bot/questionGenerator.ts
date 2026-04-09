import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../logger";
import { fetchPublicMatches, fetchPlayerStatsForRoster } from "./edgeApi";
import { getActiveEvent } from "./database";

const WIKI_CATEGORIES = [
  {
    category: "weapons",
    prompt:
      "Use your knowledge of CS2 weapons — damage, fire rate, recoil, armor penetration, kill rewards, or unique mechanics. Focus on specific factual stats.",
  },
  {
    category: "maps",
    prompt:
      "Use your knowledge of CS2 competitive maps — their history, original release dates, designers, unique callouts, bombsite layouts, or notable map changes.",
  },
  {
    category: "pro_players",
    prompt:
      "Use your knowledge of notable CS2 professional players — their nationality, career history, team history, major wins, or notable achievements.",
  },
  {
    category: "tournaments",
    prompt:
      "Use your knowledge of CS2 or CS:GO major tournaments — winners, prize pools, locations, notable moments, or records set.",
  },
  {
    category: "game_mechanics",
    prompt:
      "Use your knowledge of CS2 game mechanics — economy system, round rules, buy phase, utility (grenades/smokes/molotovs), or gameplay systems.",
  },
];

function getDayIndex() {
  return Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
}

interface TriviaQuestion {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correct: string;
  explanation: string;
  difficulty: string;
  source: string;
  category: string;
}

// When no event is set, randomize across the last ~5 pages of public matches
// (50 results × 5 pages = up to 250 matches spanning several weeks).
// When an event is set, always use page 1 to stay current.
const PUBLIC_MATCHES_PAGE_SIZE = 50;
const PUBLIC_MATCHES_MAX_RANDOM_PAGE = 5;

async function fetchEdgeData(): Promise<{
  edgeData: unknown;
  eventName: string | null;
} | null> {
  if (!process.env.EDGE_API_TOKEN) return null;

  const activeEvent = await getActiveEvent();

  // If no event is set, pick a random page to widen the date range.
  const pageNumber = activeEvent
    ? 1
    : Math.ceil(Math.random() * PUBLIC_MATCHES_MAX_RANDOM_PAGE);

  try {
    // Step 1: Fetch public matches with rosters (wider pool via page + size)
    const publicMatches = await fetchPublicMatches(PUBLIC_MATCHES_PAGE_SIZE, pageNumber);

    // Filter to matches that have actual game results
    const matchesWithGames = publicMatches.filter((m) => m.matches.length > 0);

    if (matchesWithGames.length === 0) {
      logger.warn({ pageNumber }, "No public matches with game data on this page, falling back to wiki.");
      return null;
    }

    // Pick randomly from all matches on this page
    const selected = matchesWithGames[Math.floor(Math.random() * matchesWithGames.length)];

    // Step 2: Fetch player stats for the chosen roster using correct rosterComparisons
    const playerStats = await fetchPlayerStatsForRoster(
      selected.rosterLeft.steamIds,
      activeEvent
    );

    const edgeData = {
      match: {
        playedAt: selected.playedAt,
        teamLeft: selected.rosterLeft.name,
        teamRight: selected.rosterRight.name,
        results: selected.matches,
      },
      playerStats,
    };

    logger.info(
      {
        teamLeft: selected.rosterLeft.name,
        teamRight: selected.rosterRight.name,
        gameCount: selected.matches.length,
        playedAt: selected.playedAt,
        pageNumber,
        activeEvent,
      },
      "EDGE API data fetched"
    );

    return { edgeData, eventName: activeEvent };
  } catch (err) {
    logger.warn({ err }, "EDGE API fetch failed, falling back to wiki.");
    return null;
  }
}

function buildUserMessage(
  edgeResult: { edgeData: unknown; eventName: string | null } | null,
  wikiCategory: (typeof WIKI_CATEGORIES)[0]
): string {
  if (edgeResult) {
    const { edgeData, eventName } = edgeResult;
    const scopeLabel = eventName ? `from ${eventName}` : "from recent public CS2 matches";

    return `You have two data sources available to generate today's trivia question:

SOURCE 1 — Live CS2 data from the Skybox EDGE API (PRIMARY)
This is real match and player statistics ${scopeLabel}. Prefer this source.

Data:
${JSON.stringify(edgeData, null, 2)}

SOURCE 2 — CS2 General Knowledge (SECONDARY / FALLBACK)
${wikiCategory.prompt}

Instructions:
- First try to generate a great question from SOURCE 1 (live match data)
- Only fall back to SOURCE 2 if the data is too sparse or doesn't yield an interesting question
- If you use SOURCE 1, set "source" to "edge" in your response
- If you use SOURCE 2, set "source" to "wiki" in your response`;
  }

  return `${wikiCategory.prompt}

Use your knowledge of CS2, the Counter-Strike wiki, and pro esports to generate one accurate trivia question.
Set "source" to "wiki" in your response.`;
}

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
  "category": "player_stats|team_stats|match_results|weapons|maps|pro_players|tournaments|game_mechanics"
}

Rules:
- Questions must be factually accurate and verifiable
- All four options must be plausible (avoid obvious wrong answers)
- The correct answer should be clearly correct, not ambiguous
- Keep questions engaging and relevant to CS2 esports fans
- Difficulty: easy = general knowledge, medium = knowledgeable fan, hard = expert level
- Do NOT include markdown, code blocks, or extra text — pure JSON only`;

export async function generateDailyQuestion(): Promise<TriviaQuestion> {
  const dayIndex = getDayIndex();
  const wikiCategory = WIKI_CATEGORIES[dayIndex % WIKI_CATEGORIES.length];
  const edgeResult = await fetchEdgeData();
  const userMessage = buildUserMessage(edgeResult, wikiCategory);

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

  // Strip markdown code blocks if present
  finalText = finalText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  // Extract JSON object from within the text if Claude wrapped it in prose
  const jsonMatch = finalText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Claude response did not contain a JSON object. Got: ${finalText.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as TriviaQuestion;
  return parsed;
}
