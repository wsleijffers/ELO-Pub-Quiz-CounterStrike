import { anthropic } from "@workspace/integrations-anthropic-ai";
import type Anthropic from "@anthropic-ai/sdk";
import { logger } from "../logger";
import { fetchPlayerStats, fetchTeamStats, fetchMatches, fetchClutchStats } from "./edgeApi";
import { getActiveEvent } from "./database";

const WIKI_CATEGORIES = [
  {
    category: "weapons",
    label: "🔫 Weapons",
    prompt:
      "Search the Counter-Strike Wiki at https://counterstrike.fandom.com/wiki/Counter-Strike_Wiki for detailed information about CS2 weapons — damage, fire rate, recoil, armor penetration, kill rewards, or unique mechanics. Focus on specific factual stats.",
  },
  {
    category: "maps",
    label: "🗺️ Maps",
    prompt:
      "Search the Counter-Strike Wiki at https://counterstrike.fandom.com/wiki/Counter-Strike_Wiki for information about CS2 competitive maps — their history, original release dates, designers, unique callouts, bombsite layouts, or notable map changes.",
  },
  {
    category: "pro_players",
    label: "🎯 Pro Players",
    prompt:
      "Search the Counter-Strike Wiki at https://counterstrike.fandom.com/wiki/Counter-Strike_Wiki for information about notable CS2 professional players — their nationality, career history, team history, major wins, or notable achievements.",
  },
  {
    category: "tournaments",
    label: "🏆 Tournaments",
    prompt:
      "Search the Counter-Strike Wiki at https://counterstrike.fandom.com/wiki/Counter-Strike_Wiki for information about CS2 or CS:GO major tournaments — winners, prize pools, locations, notable moments, or records set.",
  },
  {
    category: "game_mechanics",
    label: "⚙️ Game Mechanics",
    prompt:
      "Search the Counter-Strike Wiki at https://counterstrike.fandom.com/wiki/Counter-Strike_Wiki for information about CS2 game mechanics — economy system, round rules, buy phase, utility (grenades/smokes/molotovs), or gameplay systems.",
  },
];

const EDGE_TYPES = ["player_stats", "team_stats", "match_results"];

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

async function fetchEdgeData(): Promise<{
  edgeData: unknown;
  edgeType: string;
  eventName: string | null;
} | null> {
  if (!process.env.EDGE_API_TOKEN) return null;

  const activeEvent = await getActiveEvent();
  const edgeType = EDGE_TYPES[getDayIndex() % EDGE_TYPES.length];

  try {
    let edgeData: unknown;
    if (edgeType === "player_stats") {
      edgeData = await fetchPlayerStats(activeEvent);
    } else if (edgeType === "team_stats") {
      edgeData = await fetchTeamStats(activeEvent);
    } else {
      const matchData = await fetchMatches(activeEvent);
      const clutchData = await fetchClutchStats(activeEvent);
      edgeData = { matches: matchData, clutch: clutchData };
    }

    const isEmpty =
      !edgeData ||
      ((edgeData as { playerStats?: unknown[] }).playerStats?.length === 0) ||
      ((edgeData as { teamStats?: unknown[] }).teamStats?.length === 0) ||
      ((edgeData as { matches?: { entries?: unknown[] } }).matches?.entries?.length === 0);

    if (isEmpty) {
      logger.warn("EDGE API returned empty data, falling back to wiki.");
      return null;
    }

    logger.info({ edgeType, activeEvent }, "EDGE API data fetched");
    return { edgeData, edgeType, eventName: activeEvent };
  } catch (err) {
    logger.warn({ err }, "EDGE API fetch failed, falling back to wiki.");
    return null;
  }
}

function buildUserMessage(
  edgeResult: { edgeData: unknown; edgeType: string; eventName: string | null } | null,
  wikiCategory: (typeof WIKI_CATEGORIES)[0]
): string {
  if (edgeResult) {
    const { edgeData, edgeType, eventName } = edgeResult;
    const scopeLabel = eventName ? `from ${eventName}` : "across all CS2 events";
    const edgeTypeLabel: Record<string, string> = {
      player_stats: "player statistics",
      team_stats: "team statistics",
      match_results: "match results and clutch stats",
    };

    return `You have two data sources available to generate today's trivia question:

SOURCE 1 — Live CS2 data from the EDGE API (PRIMARY)
This is real ${edgeTypeLabel[edgeType] ?? edgeType} ${scopeLabel}. Prefer this source for a question grounded in real match data.

Data:
${JSON.stringify(edgeData, null, 2)}

SOURCE 2 — Counter-Strike Wiki (SECONDARY / FALLBACK)
${wikiCategory.prompt}

Instructions:
- First try to generate a great question from SOURCE 1 (live match data)
- Only fall back to SOURCE 2 (wiki search) if the data is too sparse or doesn't yield an interesting question
- If you use SOURCE 1, set "source" to "edge" in your response
- If you use SOURCE 2, set "source" to "wiki" in your response`;
  }

  return `${wikiCategory.prompt}

Use the web_search tool to find specific factual information, then generate one trivia question from what you find.
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

  const tools: Anthropic.Tool[] = [
    {
      name: "web_search",
      description: "Search the web for information to base the trivia question on",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    },
  ];

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
  let finalText = "";

  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    if (response.stop_reason === "tool_use") {
      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (toolUse && toolUse.type === "tool_use") {
        messages.push({ role: "assistant", content: response.content });
        // We don't actually have a web search tool here — return empty result
        // Claude will fall back to its training data
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: "Search unavailable. Use your training data to answer.",
            },
          ],
        });
      }
      continue;
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (textBlock && textBlock.type === "text") {
      finalText = textBlock.text.trim();
      break;
    }
  }

  if (!finalText) {
    throw new Error("Claude did not return a trivia question after multiple attempts");
  }

  // Strip markdown code blocks if present
  finalText = finalText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  const parsed = JSON.parse(finalText) as TriviaQuestion;
  return parsed;
}
