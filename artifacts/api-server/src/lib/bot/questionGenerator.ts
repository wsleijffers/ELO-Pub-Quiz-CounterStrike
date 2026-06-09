import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../logger";
import { fetchPublicMatches, fetchPlayerStatsForRosters, fetchEventPlayerStats, fetchClutchStats, fetchBombsiteStats, fetchVetoStats } from "./edgeApi";
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
  isEventMode: boolean;
  hasClutchData: boolean;
  hasBombsiteData: boolean;
  hasVetoData: boolean;
} | null> {
  if (!process.env.EDGE_API_TOKEN) return null;

  const [globalEvent, globalTeam] = await Promise.all([getActiveEvent(), getActiveTeam()]);
  const activeEvent = overrides?.eventOverride !== undefined ? overrides.eventOverride : globalEvent;
  const activeTeam = overrides?.teamOverride !== undefined ? overrides.teamOverride : globalTeam;

  // ── Option B: event-aggregate mode ────────────────────────────────────────
  // When an event is set, fetch aggregate player stats for the whole event.
  // This guarantees the data is actually from that event and avoids the mismatch
  // of applying an event filter to a randomly selected match.
  if (activeEvent) {
    try {
      const eventPlayerStats = await fetchEventPlayerStats(activeEvent);
      if (eventPlayerStats && eventPlayerStats.length > 0) {
        logger.info(
          { activeEvent, playerCount: eventPlayerStats.length },
          "Event-mode: fetched aggregate player stats for event"
        );
        return {
          edgeData: { event: activeEvent, playerStats: eventPlayerStats },
          eventName: activeEvent,
          teamName: activeTeam,
          isEventMode: true,
          hasClutchData: false,
          hasBombsiteData: false,
          hasVetoData: false,
        };
      }
      logger.warn(
        { activeEvent },
        "Event-mode: no player stats returned for event — falling back to recent match approach"
      );
    } catch (err) {
      logger.warn({ err, activeEvent }, "Event-mode fetch failed — falling back to recent match approach");
    }
  }

  // ── Option A fallback: recent match mode ──────────────────────────────────
  // Used when no event is set, or when the event returned no stats.
  // Player stats are NOT filtered by event here — we use the match's own players.
  const now = new Date();
  const windowStart = new Date(now.getTime() - PUBLIC_MATCHES_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const after = isoUtc(windowStart);
  const before = isoUtc(now);
  const pageNumber = Math.ceil(Math.random() * PUBLIC_MATCHES_MAX_RANDOM_PAGE);

  try {
    const publicMatches = await fetchPublicMatches(PUBLIC_MATCHES_PAGE_SIZE, pageNumber, after, before);

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

    // Fetch player stats, clutch, bombsite, and veto stats in parallel.
    // Clutch, bombsite, and veto are best-effort — a failure or empty result
    // just means those question categories won't be offered today.
    const [playerStats, clutchStats, bombsiteStats, vetoLeft, vetoRight] = await Promise.all([
      fetchPlayerStatsForRosters(selected.rosterLeft.steamIds, selected.rosterRight.steamIds, null),
      fetchClutchStats(selected.rosterLeft.steamIds, selected.rosterRight.steamIds),
      fetchBombsiteStats(selected.rosterLeft.steamIds, selected.rosterRight.steamIds),
      fetchVetoStats(selected.rosterLeft.steamIds),
      fetchVetoStats(selected.rosterRight.steamIds),
    ]);

    const leftEmpty = !playerStats.left || (playerStats.left as unknown[]).length === 0;
    const rightEmpty = !playerStats.right || (playerStats.right as unknown[]).length === 0;
    if (leftEmpty && rightEmpty) {
      logger.warn(
        { teamLeft: selected.rosterLeft.name, teamRight: selected.rosterRight.name },
        "Both rosters returned empty player stats — falling back to wiki."
      );
      return null;
    }

    const hasClutchData = clutchStats.length > 0;
    const hasBombsiteData = bombsiteStats.length > 0;
    const hasVetoData = vetoLeft.length > 0 || vetoRight.length > 0;

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
      ...(hasClutchData ? { clutchStats } : {}),
      ...(hasBombsiteData ? { bombsiteStats } : {}),
      ...(hasVetoData ? {
        vetoStats: {
          [selected.rosterLeft.name]: vetoLeft,
          [selected.rosterRight.name]: vetoRight,
        },
      } : {}),
    };

    logger.info(
      {
        teamLeft: selected.rosterLeft.name,
        teamRight: selected.rosterRight.name,
        leftPlayerCount: (playerStats.left as unknown[])?.length ?? 0,
        rightPlayerCount: (playerStats.right as unknown[])?.length ?? 0,
        clutchPlayerCount: clutchStats.length,
        bombsiteEntryCount: bombsiteStats.length,
        vetoMapsLeft: vetoLeft.length,
        vetoMapsRight: vetoRight.length,
        gameCount: selected.matches.length,
        playedAt: selected.playedAt,
        pageNumber,
        activeEvent: activeEvent ?? "none",
      },
      "Match-mode: EDGE API data fetched for both rosters"
    );

    // NOTE: we do NOT forward activeEvent here — the match data is not
    // filtered to that event (we only reached this branch because the event
    // returned no player stats), so including the event name in the prompt
    // would mislead Claude into attributing the match to the wrong event.
    return { edgeData, eventName: null, teamName: activeTeam, isEventMode: false, hasClutchData, hasBombsiteData, hasVetoData };
  } catch (err) {
    logger.warn({ err }, "EDGE API fetch failed, falling back to wiki.");
    return null;
  }
}

// ─── Prompt assembly ──────────────────────────────────────────────────────────

function buildUserMessage(
  edgeResult: { edgeData: unknown; eventName: string | null; teamName: string | null; isEventMode: boolean; hasClutchData: boolean; hasBombsiteData: boolean; hasVetoData: boolean } | null,
  dayIndex: number,
  overrides?: QuestionOverrides
): string {
  const hasEdgeData = edgeResult !== null;
  const isEventMode = edgeResult?.isEventMode ?? false;
  const extras = {
    hasClutchData: edgeResult?.hasClutchData ?? false,
    hasBombsiteData: edgeResult?.hasBombsiteData ?? false,
    hasVetoData: edgeResult?.hasVetoData ?? false,
  };

  // Pick category — respects event mode and data availability flags
  let category = pickCategoryForDay(dayIndex, hasEdgeData, isEventMode, extras);
  if (overrides?.categoryOverride) {
    const found = QUESTION_CATEGORIES.find((c) => c.id === overrides.categoryOverride);
    // Only accept the override if it's compatible with the current mode and available data
    if (
      found &&
      (!isEventMode || !found.requiresMatchData) &&
      (!found.requiresClutchData || extras.hasClutchData) &&
      (!found.requiresBombsiteData || extras.hasBombsiteData) &&
      (!found.requiresVetoData || extras.hasVetoData)
    ) {
      category = found;
    }
  }

  if (edgeResult) {
    const { edgeData, eventName, teamName, isEventMode: eventMode } = edgeResult;

    const scopeLabel = eventMode
      ? `aggregate player stats across all matches in ${eventName}`
      : [
          eventName ? eventName : null,
          teamName ? `featuring ${teamName}` : null,
        ].filter(Boolean).join(" ") || "recent public CS2 matches";

    const eventModeNote = eventMode
      ? `NOTE: This is EVENT-LEVEL aggregate data — a flat playerStats array covering all players across the entire event. There are no individual match breakdowns or team subdivisions. Frame your question as "Who led ${eventName} in [stat]?" not "In this match...".`
      : "";

    return `Live CS2 data from the Skybox EDGE API (${scopeLabel}):
${JSON.stringify(edgeData, null, 2)}

---
MANDATORY REQUIREMENTS — read before generating the question:
1. Your question MUST be answerable ONLY by reading the data above. If someone without the data could answer it, you have failed.
2. Every player name used in the question or as an answer option MUST come from "playerHandles" in the data above. Do NOT invent or recall player names from memory.
3. Every stat or score used MUST be the exact value from the data above. Do NOT estimate, round, or recall from memory.
4. The correct answer and all three wrong answers must be drawn from real values in the data (real player handles, real scores, real map names).
5. Do NOT ask conceptual, definitional, or historical questions. Do NOT ask what a metric means. Do NOT ask who is "known as" or "regarded as" anything.
6. Set "source" to "edge" and "category" to "${category.id}" in your response.
${eventModeNote ? `7. ${eventModeNote}` : ""}

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

async function callClaude(userMessage: string): Promise<TriviaQuestion | null> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;

  let finalText = textBlock.text.trim();
  finalText = finalText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  const jsonMatch = finalText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn({ preview: finalText.slice(0, 300) }, "Claude returned non-JSON — will retry with wiki fallback");
    return null;
  }

  return JSON.parse(jsonMatch[0]) as TriviaQuestion;
}

export async function generateDailyQuestion(overrides?: QuestionOverrides): Promise<TriviaQuestion> {
  const dayIndex = getDayIndex();
  const edgeResult = await fetchEdgeData(overrides);
  const userMessage = buildUserMessage(edgeResult, dayIndex, overrides);

  let parsed = await callClaude(userMessage);

  // If Claude declined to produce JSON (e.g. empty player stats slipped through,
  // or the data was insufficient), retry with a plain wiki question so the post
  // never fails outright.
  if (!parsed && edgeResult !== null) {
    logger.warn("Edge-data question failed — retrying as wiki fallback");
    const wikiMessage = buildUserMessage(null, dayIndex, overrides);
    parsed = await callClaude(wikiMessage);
  }

  if (!parsed) {
    throw new Error("Claude failed to produce a valid JSON question after two attempts");
  }

  // Override source based on what the code actually did — if edgeResult was
  // non-null and the first attempt succeeded, the question is "edge".
  // If we fell back to wiki, edgeResult is null so source stays "wiki".
  if (edgeResult !== null && parsed.source !== "wiki") {
    parsed.source = "edge";
  }

  return parsed;
}
