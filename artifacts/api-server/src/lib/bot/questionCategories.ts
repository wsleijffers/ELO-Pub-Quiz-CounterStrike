/**
 * QUESTION CATEGORIES
 *
 * This file is the single source of truth for what kinds of trivia questions
 * the bot generates. Edit this file to add, remove, or tune categories.
 *
 * EDGE-data categories use live Skybox EDGE API match data (player stats,
 * map results, team performance). They are preferred when live data is
 * available.
 *
 * Wiki categories fall back to Claude's general CS2 knowledge.
 *
 * Each day the bot cycles through categories in order (by day-of-year index),
 * giving a varied mix across the week.
 *
 * EDGE API fields available per player:
 *   playerHandles      — in-game name(s)
 *   kills              — total kills across the match / event
 *   deaths             — total deaths
 *   kasts              — rounds with Kill, Assist, Survived, or Traded (%)
 *   assists            — total assists
 *   hsKills            — headshot kills
 *   damageGiven        — total damage dealt
 *   entryKills         — first-blood kills (opening duels won)
 *   entryDeaths        — first-blood deaths (opening duels lost)
 *   mapsPlayed         — number of maps played
 *   mapsWon            — number of maps won
 *   roundsPlayed       — total rounds played
 *   roundsWon          — total rounds won
 *   player.nationality — player's nationality
 *
 * Match-level fields:
 *   teamLeft / teamRight   — team names
 *   results[].map          — map name (e.g. "de_dust2")
 *   results[].alphaFinalScore / bravoFinalScore — map scores
 *   results[].winner       — "alpha" or "bravo"
 */

export interface QuestionCategory {
  id: string;
  label: string;

  /**
   * Whether this category requires live EDGE API data.
   * If true and no data is available, the bot falls back to the next wiki category.
   */
  requiresEdgeData: boolean;

  /**
   * Whether this category requires specific per-match data (map scores, series
   * results). Categories with this flag cannot be used in event-aggregate mode,
   * where only player stats are available — not individual match breakdowns.
   */
  requiresMatchData?: boolean;

  /**
   * Whether this category requires clutch stats (1v1–1v5 data).
   * Skipped automatically if the clutch fetch returned no results.
   */
  requiresClutchData?: boolean;

  /**
   * Whether this category requires bombsite stats (A/B site attack/defend data).
   * Skipped automatically if the bombsite fetch returned no results.
   */
  requiresBombsiteData?: boolean;

  /**
   * Whether this category requires veto stats (map pick/ban history per team).
   * Skipped automatically if the veto fetch returned no results.
   */
  requiresVetoData?: boolean;

  /**
   * The instruction sent to Claude describing what kind of question to generate.
   * Be specific about which data fields to use and what makes a good wrong answer.
   */
  prompt: string;
}

export const QUESTION_CATEGORIES: QuestionCategory[] = [
  // ─── EDGE-data categories ────────────────────────────────────────────────────
  // These require live match data from the Skybox EDGE API.

  {
    id: "top_fragger",
    label: "Top Fragger",
    requiresEdgeData: true,
    prompt: `STEP 1: Read the "kills" value for every player in both team rosters in the data.
STEP 2: Identify the player handle (from "playerHandles") with the single highest kill count.
STEP 3: Write a question that asks which player led BOTH teams in total kills in this specific match. The question must name the exact team names (teamLeft vs teamRight) and the date or event if present.
STEP 4: The correct answer is that player's exact handle. The three wrong answers must be real player handles from the same match data — pick the next highest kill-count players so the options are believable.
IMPORTANT: Never invent player names. Never ask a general question about who is "known as" a top fragger. The question must only be answerable using the numbers in the data.
Example output: "In the match between [teamLeft] and [teamRight], which player recorded the most total kills across all maps?"`,
  },

  {
    id: "map_result",
    label: "Map Result",
    requiresEdgeData: true,
    requiresMatchData: true,
    prompt: `STEP 1: Pick one map from the "results" array (choose the most interesting — e.g. closest scoreline or map 1).
STEP 2: Read the exact alphaFinalScore and bravoFinalScore for that map, and which team won.
STEP 3: Write a question asking either (a) what the final score was on that specific map, or (b) which team won it. The question must name the exact map name, both team names, and the event/date.
STEP 4: The correct answer is the exact real scoreline (e.g. "16-12"). The three wrong answers must be plausible alternative CS2 scorelines that were NOT the actual result (e.g. 13-10, 16-8, 19-17).
IMPORTANT: Use the real scores from the data. Do not round or approximate. Only ask about a map that actually appears in the results array.
Example output: "What was the final score on de_mirage when [teamLeft] faced [teamRight] at [event]?"`,
  },

  {
    id: "entry_specialist",
    label: "Entry Specialist",
    requiresEdgeData: true,
    prompt: `STEP 1: Read the "entryKills" value for every player in both rosters in the data.
STEP 2: Identify the player handle with the single highest entryKills count.
STEP 3: Write a question asking which player won the most opening duels (entry kills) across both teams in this specific match. Name the exact team names and event.
STEP 4: The correct answer is that player's exact handle. The three wrong answers must be real player handles from the match data with lower (but plausible) entryKills counts.
IMPORTANT: entryKills = first-blood opening kills. Never invent player names. Never ask a conceptual question about what entry fragging means.
Example output: "Who secured the most entry kills across both teams in the [teamLeft] vs [teamRight] match at [event]?"`,
  },

  {
    id: "kast_leader",
    label: "KAST Leader",
    requiresEdgeData: true,
    prompt: `STEP 1: Read the "kasts" value (KAST%) for every player in both rosters in the data.
STEP 2: Identify the player handle with the single highest KAST% value.
STEP 3: Write a question asking which player had the highest KAST% in this specific match. Name the exact team names and event. Include the actual winning KAST% value in the explanation field.
STEP 4: The correct answer is that player's exact handle. The three wrong answers must be real player handles from the same match with lower (but plausible) KAST% values.
IMPORTANT: KAST% = percentage of rounds with a Kill, Assist, Survived, or Traded. Do NOT ask what KAST stands for. Do NOT ask what a "good" KAST% benchmark is. The question must be answerable only by knowing who is in the data.
Example output: "Which player posted the highest KAST% across both teams in the [teamLeft] vs [teamRight] series?"`,
  },

  {
    id: "damage_dealer",
    label: "Damage Dealer",
    requiresEdgeData: true,
    prompt: `STEP 1: Read the "damageGiven" value for every player in both rosters in the data.
STEP 2: Identify the player handle with the single highest total damage dealt.
STEP 3: Write a question asking which player dealt the most damage across both teams in this specific match. Name the exact team names and event.
STEP 4: The correct answer is that player's exact handle. The three wrong answers must be real player handles from the match with lower damage totals.
IMPORTANT: Use actual damageGiven numbers from the data. Never invent player names. The explanation should state the actual damage figure the winner dealt.
Example output: "Which player dealt the most total damage in the [teamLeft] vs [teamRight] match at [event]?"`,
  },

  {
    id: "headshot_rate",
    label: "Headshot King",
    requiresEdgeData: true,
    prompt: `STEP 1: Read the "hsKills" value for every player in both rosters in the data.
STEP 2: Identify the player handle with the single highest number of headshot kills.
STEP 3: Write a question asking which player registered the most headshot kills across both teams in this specific match. Name the exact team names and event.
STEP 4: The correct answer is that player's exact handle. The three wrong answers must be real player handles from the match with lower hsKills counts.
IMPORTANT: Use real hsKills numbers. Do not ask about headshot percentages or general headshot mechanics. The explanation should include the actual headshot kill count.
Example output: "Who landed the most headshot kills when [teamLeft] took on [teamRight] at [event]?"`,
  },

  {
    id: "series_score",
    label: "Series Score",
    requiresEdgeData: true,
    requiresMatchData: true,
    prompt: `STEP 1: Count the number of maps each team won in the "results" array. A map is won by whichever team has the higher final score on it.
STEP 2: Express the series result as "X-Y" where X = maps won by teamLeft and Y = maps won by teamRight.
STEP 3: Write a question asking what the final series scoreline was between these two teams. Name the exact team names and event.
STEP 4: The correct answer is the real series score (e.g. "2-1"). The three wrong answers must be plausible but incorrect series scores for the same number of maps played (e.g. if it was a best-of-3, wrong options are 2-0, 1-2, 0-2).
IMPORTANT: Count every map in the results array. Do not guess. The explanation should list which team won each map.
Example output: "What was the series result when [teamLeft] faced [teamRight] at [event]?"`,
  },

  {
    id: "maps_played",
    label: "Maps Played",
    requiresEdgeData: true,
    requiresMatchData: true,
    prompt: `STEP 1: Read the "map" field for every entry in the "results" array to get the exact list of maps played.
STEP 2: Choose one of these two question styles:
  (a) "Which map was played as map N in the series?" — correct answer is the real map from results[N-1].map
  (b) "How many maps were played in total in this series?" — correct answer is results.length
STEP 3: Name the exact team names and event in the question.
STEP 4: Wrong answers for (a) must be real CS2 competitive maps that were NOT played in this series. Wrong answers for (b) must be plausible but incorrect map counts (e.g. if 3 maps were played, wrong options are 1, 2, 4).
IMPORTANT: Only reference maps that actually appear in the results array. Never invent or guess map names.
Example output (style a): "Which map did [teamLeft] and [teamRight] play as map 2 of their series at [event]?"`,
  },

  {
    id: "clutch_king",
    label: "Clutch King",
    requiresEdgeData: true,
    requiresMatchData: true,
    requiresClutchData: true,
    prompt: `STEP 1: Read the "clutchStats" array in the data. Each entry has a player handle and 1v1 through 1v5 clutch fields: clutch1v1Played / clutch1v1Won, clutch1v2Played / clutch1v2Won, etc.
STEP 2: Choose ONE of these question styles:
  (a) "Which player won the most 1v1 clutches in this match?" — sum clutch1v1Won across all players, find the highest.
  (b) "Which player attempted the most 1v2 clutches?" — find the highest clutch1v2Played.
  (c) "Which player had the best 1vX clutch win rate?" — wins ÷ attempts for a specific clutch type, minimum 2 attempts.
STEP 3: Name the exact team names and event. State the actual clutch count in the explanation.
STEP 4: The correct answer is the real player handle with the highest count. The three wrong answers must be real player handles from the clutchStats data with lower counts.
IMPORTANT: Only reference players and numbers that appear in clutchStats. A "clutch" is a round won against multiple alive opponents when your team had no one else alive. Do NOT invent clutch counts.
Example output: "Which player won the most 1v2 clutch rounds in the [teamLeft] vs [teamRight] match?"`,
  },

  {
    id: "bombsite_mastery",
    label: "Bombsite Mastery",
    requiresEdgeData: true,
    requiresMatchData: true,
    requiresBombsiteData: true,
    prompt: `STEP 1: Read the "bombsiteStats" array in the data. Each entry has: map, site (A or B), roundsAttackAttempts, roundsAttackSuccess, roundsDefendAttempts, roundsDefendSuccess, roundsAttackPostplantSuccess, roundsDefendPostplantSuccess.
STEP 2: Choose ONE of these question styles — pick the one with the most interesting/surprising finding:
  (a) "Which bombsite on [map] had a higher CT defend success rate — A or B?" — compare roundsDefendSuccess/roundsDefendAttempts for site A vs B on the same map.
  (b) "On which map was the T-side attack more successful — [map1] or [map2]?" — compare roundsAttackSuccess/roundsAttackAttempts across maps.
  (c) "What percentage of A-site attacks on [map] resulted in a successful plant and explosion?" — use roundsAttackPostplantSuccess / roundsAttackAttempts.
STEP 3: Name the exact team names and event. Include the actual percentages in the explanation.
STEP 4: The correct answer is "A site" / "B site" / a map name / a percentage. The three wrong answers must be plausible alternatives drawn from the real data.
IMPORTANT: Calculate percentages as roundsSuccess / roundsAttempts × 100. Round to the nearest whole number. Only reference maps and sites that appear in bombsiteStats.
Example output: "On de_mirage in the [teamLeft] vs [teamRight] match, which bombsite did the attacking team successfully take more often — A site or B site?"`,
  },

  {
    id: "map_veto",
    label: "Map Veto",
    requiresEdgeData: true,
    requiresMatchData: true,
    requiresVetoData: true,
    prompt: `You are given veto statistics for two teams involved in today's match. The data shows, per map, how often each team first-bans, second-bans, first-picks, or plays it as a decider in their recent BO3 matches.

STEP 1: Read the vetoStats for both teams carefully. Look for the most striking pattern — e.g. a map that was first-banned in nearly every match, a map that is always first-picked, or a map with the highest/lowest preferenceScore.

STEP 2: Write a question about one of these clear patterns. Good question types:
  - "Which map did [Team] ban first in all (or almost all) of their recent BO3 matches?"
  - "Which map did [Team] most often pick first in their recent BO3 matches?"
  - "Between [MapA] and [MapB], which did [Team] first-ban more often?"
  - "Across their recent BO3s, how many times did [Team] pick [Map] first?" (use the real count as correct answer)

STEP 3: The correct answer must be the exact value from the data. Wrong answers must be real map names or plausible counts from the same data — not invented.

IMPORTANT:
- Only ask about BO3 data (bo3FirstBans, bo3SecondBans, bo3FirstPicks, bo3Deciders).
- The preferenceScore ranges from -1 (always avoided/banned) to +1 (always picked). You may use it to identify the most/least preferred map, but frame questions in plain English — not as raw numbers.
- Only reference maps where bo3MapPoolCount > 0 (already filtered in the data).
- Do NOT ask vague questions like "which map does [Team] play best on." The question must be answerable only from the numbers in the data.`,
  },

  // ─── Wiki / general knowledge categories ─────────────────────────────────────
  // These use Claude's built-in CS2 knowledge. Used as fallback or on rotation.

  {
    id: "weapons",
    label: "Weapons",
    requiresEdgeData: false,
    prompt: `Generate a specific factual question about a CS2 weapon. Focus on exact, verifiable stats or mechanics — not vague impressions.
Good topics: exact kill reward in dollars, exact damage to helmeted/unarmeted targets, magazine size, fire rate category, unique mechanic (e.g. Zeus one-shot, Deagle penetration), price.
The correct answer must be a specific number, name, or fact. All three wrong answers must be plausible but incorrect alternatives (e.g. nearby dollar amounts, nearby damage values).
Do NOT ask "which weapon is best for..." or any subjective question.
Example: "What is the kill reward for the AK-47 in CS2?" (Answer: $300)`,
  },

  {
    id: "maps",
    label: "Maps",
    requiresEdgeData: false,
    prompt: `Generate a specific factual question about a CS2 competitive map. Focus on verifiable facts — not player opinions or meta.
Good topics: which bombsite is underground on de_nuke, the real-world location a map is set in, when a map was added or removed from the Active Duty pool, a specific callout name, or a notable layout change between CS:GO and CS2.
The correct answer must be a specific fact. Wrong answers must be plausible alternatives drawn from real CS2 maps or locations.
Do NOT ask vague questions like "which map is most popular" or "which map has the best mid."
Example: "Which bombsite on de_nuke is located underground?" (Answer: B site)`,
  },

  {
    id: "pro_players",
    label: "Pro Players",
    requiresEdgeData: false,
    prompt: `Generate a specific factual question about a well-known CS2 professional player. Focus on verifiable career facts.
Good topics: nationality, the team a player is currently or was most famously on, a specific Major win, a record they hold (e.g. most Major MVPs), or a notable roster move.
The correct answer must be a verifiable fact. Wrong answers must be plausible alternatives — other real player names or real countries.
Do NOT ask vague questions like "who is considered the best player." Do NOT ask about players outside the top tier of pro CS2.
Example: "Which country does ZywOo represent?" (Answer: France)`,
  },

  {
    id: "tournaments",
    label: "Tournaments",
    requiresEdgeData: false,
    prompt: `Generate a specific factual question about a CS2 or CS:GO Major or premier tournament. Focus on verifiable facts.
Good topics: which team won a specific Major, the host city of a tournament, the prize pool of a specific event, a record set at a tournament, or a specific year a team won.
The correct answer must be a verifiable fact. Wrong answers must be real team names, real cities, or plausible prize pool amounts — not invented options.
Do NOT ask vague questions like "which is the most prestigious tournament." Only reference Majors or well-documented premier events.
Example: "Which team won the first CS2 Major (Copenhagen 2024)?" (Answer: Natus Vincere)`,
  },

  {
    id: "game_mechanics",
    label: "Game Mechanics",
    requiresEdgeData: false,
    prompt: `Generate a specific factual question about a CS2 game mechanic. Focus on exact rules or numbers — not general descriptions.
Good topics: exact number of rounds to win a map (13 in regulation), bomb timer duration (40 seconds), defuse time with/without kit (10s / 5s), how much money teams start with ($800), max money cap ($16,000), or how overtime works.
The correct answer must be a specific number or rule. Wrong answers must be plausible but incorrect alternatives (e.g. nearby numbers).
Do NOT ask vague questions like "what is the economy system" or conceptual questions like "what does KAST stand for."
Example: "How long does the bomb take to explode after being planted in CS2?" (Answer: 40 seconds)`,
  },
];

/**
 * Returns the category for a given day, cycling through the eligible list.
 *
 * Filtering rules (applied in order):
 *  1. EDGE categories only when live data is available.
 *  2. In event-aggregate mode, exclude match-specific categories.
 *  3. Exclude clutch-king when no clutch data was returned.
 *  4. Exclude bombsite-mastery when no bombsite data was returned.
 */
export function pickCategoryForDay(
  dayIndex: number,
  hasEdgeData: boolean,
  isEventMode = false,
  extras: { hasClutchData?: boolean; hasBombsiteData?: boolean; hasVetoData?: boolean } = {},
): QuestionCategory {
  if (hasEdgeData) {
    const edgeCategories = QUESTION_CATEGORIES.filter((c) => {
      if (!c.requiresEdgeData) return false;
      if (isEventMode && c.requiresMatchData) return false;
      if (c.requiresClutchData && !extras.hasClutchData) return false;
      if (c.requiresBombsiteData && !extras.hasBombsiteData) return false;
      if (c.requiresVetoData && !extras.hasVetoData) return false;
      return true;
    });
    return edgeCategories[dayIndex % edgeCategories.length];
  }
  const wikiCategories = QUESTION_CATEGORIES.filter((c) => !c.requiresEdgeData);
  return wikiCategories[dayIndex % wikiCategories.length];
}
