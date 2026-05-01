# Question Categories

This document defines every question category the trivia bot can generate.
The source of truth is `questionCategories.ts` — editing that file is all that is needed to add, remove, or tune a category.

---

## How categories work

Each day the bot picks one category based on the day-of-year index, cycling through the list.

- **If live EDGE API data is available**, the bot picks from the live-data categories and passes real match data to Claude along with the category's instructions.
- **If no live data is available**, the bot falls back to the general knowledge categories.

---

## Live-data categories

These require a real CS2 match from the Skybox EDGE API. Claude receives the full match JSON (both team rosters, map-by-map scores, and per-player stats for every player on both sides) alongside the category instructions below.

---

### 1. Top Fragger

**What it asks:** Which player had the most kills in the match or series?

**Claude instruction:**
> Using the player stats provided, ask which player had the most kills in this match or series.
> Use the "kills" field. The correct answer is the player with the highest kill count.
> Make the three wrong answers other players from the same match with plausible but lower kill counts.
> Example: "Which player led [Team A] vs [Team B] in total kills?"

**EDGE API field used:** `kills`

---

### 2. Map Result

**What it asks:** What was the scoreline or winner on a specific map?

**Claude instruction:**
> Using the match results provided, ask about the scoreline or winner of a specific map in the series.
> Pick one of the maps from "results" and ask either (a) what the final score was, or (b) which team won it.
> Make wrong answers plausible alternative scores (e.g. 13-10 vs 16-12 vs 16-8 vs 13-7).
> Example: "What was the final score on [map] when [Team A] faced [Team B]?"

**EDGE API fields used:** `results[].map`, `results[].alphaFinalScore`, `results[].bravoFinalScore`, `results[].winner`

---

### 3. Entry Specialist

**What it asks:** Which player won the most opening duels (entry kills)?

**Claude instruction:**
> Using the player stats provided, ask which player had the most entry kills (first-blood opening kills).
> Use the "entryKills" field. The correct answer is the player with the highest entry kill count.
> Wrong answers should be other players from the match with plausible but lower entry kill counts.
> Example: "Who opened the most duels for [Team] in their match against [Opponent]?"

**EDGE API field used:** `entryKills`

---

### 4. KAST Leader

**What it asks:** Which player had the highest KAST percentage?

**Claude instruction:**
> Using the player stats provided, ask which player had the highest KAST percentage (rounds with a Kill, Assist, Survived, or Traded).
> Use the "kasts" field. KAST is a key consistency metric in professional CS2.
> Wrong answers should be other players from the match with slightly lower but plausible KAST values.
> Example: "Which player had the highest KAST% in [Team A]'s match against [Team B]?"

**EDGE API field used:** `kasts`

---

### 5. Damage Dealer

**What it asks:** Which player dealt the most total damage?

**Claude instruction:**
> Using the player stats provided, ask which player dealt the most total damage in the match.
> Use the "damageGiven" field. The correct answer is the highest value.
> Wrong answers should be other players from the same match with plausible damage totals.
> Example: "Which player dealt the most damage across the entire series in [Team A] vs [Team B]?"

**EDGE API field used:** `damageGiven`

---

### 6. Headshot King

**What it asks:** Which player had the most headshot kills?

**Claude instruction:**
> Using the player stats provided, ask which player had the most headshot kills in the match.
> Use the "hsKills" field. The correct answer is the highest value.
> Wrong answers should be other players with plausible but lower headshot kill counts.
> Example: "Who registered the most headshot kills when [Team A] played [Team B]?"

**EDGE API field used:** `hsKills`

---

### 7. Series Score

**What it asks:** What was the overall map score of the series (e.g. 2-1, 2-0)?

**Claude instruction:**
> Using the match results provided, ask what the overall series score was (i.e. how many maps each team won).
> Count the number of maps each team won from the "results" array and ask which score is correct.
> Wrong answers should be plausible alternative series scores (e.g. 2-0 vs 2-1 vs 1-2 vs 0-2).
> Example: "What was the series result when [Team A] faced [Team B]?"

**EDGE API fields used:** `results[].winner` (counted across all maps)

---

### 8. Maps Played

**What it asks:** Which map was played at a specific point in the series, or how many maps total?

**Claude instruction:**
> Using the match results provided, ask which map was played in a specific game of the series (e.g. map 1, map 2).
> Or ask how many total maps were played in the series.
> Wrong answers should be other CS2 competitive maps (de_dust2, de_mirage, de_inferno, de_nuke, de_ancient, de_anubis, de_vertigo).
> Example: "Which map did [Team A] and [Team B] play as map 2 of their series?"

**EDGE API field used:** `results[].map`

---

## General knowledge categories

Used as fallback when no live EDGE API data is available, or in rotation alongside live-data questions.

---

### 9. Weapons

Questions about CS2 weapon stats — damage values, fire rate, recoil, armor penetration, kill rewards, or unique mechanics.

---

### 10. Maps

Questions about CS2 competitive maps — history, release dates, designers, callouts, bombsite layouts, or notable changes from CS:GO to CS2.

---

### 11. Pro Players

Questions about professional CS2 players — nationality, career history, team history, major wins, or notable achievements.

---

### 12. Tournaments

Questions about CS2 or CS:GO major tournaments — winners, prize pools, locations, notable moments, or records.

---

### 13. Game Mechanics

Questions about CS2 gameplay systems — economy, buy phase, round rules, utility (grenades, smokes, molotovs), or core mechanics.

---

## Available EDGE API player fields (reference)

| Field | Description |
|---|---|
| `playerHandles` | In-game name(s) |
| `kills` | Total kills |
| `deaths` | Total deaths |
| `kasts` | KAST % (Kill / Assist / Survived / Traded) |
| `assists` | Total assists |
| `hsKills` | Headshot kills |
| `damageGiven` | Total damage dealt |
| `entryKills` | First-blood kills (opening duels won) |
| `entryDeaths` | First-blood deaths (opening duels lost) |
| `mapsPlayed` | Maps played |
| `mapsWon` | Maps won |
| `roundsPlayed` | Rounds played |
| `roundsWon` | Rounds won |
| `player.nationality` | Player nationality |
