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
    prompt: `Using the player stats provided, ask which player had the most kills in this match or series.
Use the "kills" field. The correct answer is the player with the highest kill count.
Make the three wrong answers other players from the same match with plausible but lower kill counts.
Example question style: "Which player led [Team A] vs [Team B] in total kills?"`,
  },

  {
    id: "map_result",
    label: "Map Result",
    requiresEdgeData: true,
    prompt: `Using the match results provided, ask about the scoreline or winner of a specific map in the series.
Pick one of the maps from "results" and ask either (a) what the final score was, or (b) which team won it.
Make wrong answers plausible alternative scores (e.g. 13-10 vs 16-12 vs 16-8 vs 13-7).
Example: "What was the final score on [map] when [Team A] faced [Team B]?"`,
  },

  {
    id: "entry_specialist",
    label: "Entry Specialist",
    requiresEdgeData: true,
    prompt: `Using the player stats provided, ask which player had the most entry kills (first-blood opening kills).
Use the "entryKills" field. The correct answer is the player with the highest entry kill count.
Wrong answers should be other players from the match with plausible but lower entry kill counts.
Example: "Who opened the most duels for [Team] in their match against [Opponent]?"`,
  },

  {
    id: "kast_leader",
    label: "KAST Leader",
    requiresEdgeData: true,
    prompt: `Using the player stats provided, ask which player had the highest KAST percentage (rounds with a Kill, Assist, Survived, or Traded).
Use the "kasts" field. KAST is a key consistency metric in professional CS2.
Wrong answers should be other players from the match with slightly lower but plausible KAST values.
Example: "Which player had the highest KAST% in [Team A]'s match against [Team B]?"`,
  },

  {
    id: "damage_dealer",
    label: "Damage Dealer",
    requiresEdgeData: true,
    prompt: `Using the player stats provided, ask which player dealt the most total damage in the match.
Use the "damageGiven" field. The correct answer is the highest value.
Wrong answers should be other players from the same match with plausible damage totals.
Example: "Which player dealt the most damage across the entire series in [Team A] vs [Team B]?"`,
  },

  {
    id: "headshot_rate",
    label: "Headshot King",
    requiresEdgeData: true,
    prompt: `Using the player stats provided, ask which player had the most headshot kills in the match.
Use the "hsKills" field. The correct answer is the highest value.
Wrong answers should be other players with plausible but lower headshot kill counts.
Example: "Who registered the most headshot kills when [Team A] played [Team B]?"`,
  },

  {
    id: "series_score",
    label: "Series Score",
    requiresEdgeData: true,
    prompt: `Using the match results provided, ask what the overall series score was (i.e. how many maps each team won).
Count the number of maps each team won from the "results" array and ask which score is correct.
Wrong answers should be plausible alternative series scores (e.g. 2-0 vs 2-1 vs 1-2 vs 0-2).
Example: "What was the series result when [Team A] faced [Team B]?"`,
  },

  {
    id: "maps_played",
    label: "Maps Played",
    requiresEdgeData: true,
    prompt: `Using the match results provided, ask which map was played in a specific game of the series (e.g. map 1, map 2).
Or ask how many total maps were played in the series.
Wrong answers should be other CS2 competitive maps (de_dust2, de_mirage, de_inferno, de_nuke, de_ancient, de_anubis, de_vertigo).
Example: "Which map did [Team A] and [Team B] play as map 2 of their series?"`,
  },

  // ─── Wiki / general knowledge categories ─────────────────────────────────────
  // These use Claude's built-in CS2 knowledge. Used as fallback or on rotation.

  {
    id: "weapons",
    label: "Weapons",
    requiresEdgeData: false,
    prompt: `Use your knowledge of CS2 weapons — damage, fire rate, recoil patterns, armor penetration, kill rewards, or unique mechanics.
Focus on specific factual stats that knowledgeable fans would know.
Example: "What is the kill reward for the AK-47 in CS2?"`,
  },

  {
    id: "maps",
    label: "Maps",
    requiresEdgeData: false,
    prompt: `Use your knowledge of CS2 competitive maps — their history, original release dates, designers, unique callouts, bombsite layouts, or notable changes between CS:GO and CS2.
Example: "Which bombsite on de_nuke is located underground?"`,
  },

  {
    id: "pro_players",
    label: "Pro Players",
    requiresEdgeData: false,
    prompt: `Use your knowledge of notable CS2 professional players — their nationality, career history, team history, major wins, or notable achievements.
Example: "Which country does s1mple represent?"`,
  },

  {
    id: "tournaments",
    label: "Tournaments",
    requiresEdgeData: false,
    prompt: `Use your knowledge of CS2 or CS:GO major tournaments — winners, prize pools, locations, notable moments, or records set.
Example: "Which team won the first CS2 Major tournament?"`,
  },

  {
    id: "game_mechanics",
    label: "Game Mechanics",
    requiresEdgeData: false,
    prompt: `Use your knowledge of CS2 game mechanics — economy system, round rules, buy phase, utility (grenades, smokes, molotovs, flashbangs), or core gameplay systems.
Example: "How many rounds must a team win to take a map in a standard competitive match?"`,
  },
];

/**
 * Returns the category for a given day, cycling through the full list.
 * EDGE-data categories are tried first if live data is available.
 */
export function pickCategoryForDay(
  dayIndex: number,
  hasEdgeData: boolean
): QuestionCategory {
  if (hasEdgeData) {
    const edgeCategories = QUESTION_CATEGORIES.filter((c) => c.requiresEdgeData);
    return edgeCategories[dayIndex % edgeCategories.length];
  }
  const wikiCategories = QUESTION_CATEGORIES.filter((c) => !c.requiresEdgeData);
  return wikiCategories[dayIndex % wikiCategories.length];
}
