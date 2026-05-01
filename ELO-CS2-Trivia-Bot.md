# ELO CS2 Daily Trivia Bot

## What It Does

The ELO CS2 Daily Trivia Bot posts one Counter-Strike 2 trivia question every day at **09:00 UTC** directly in your Discord server. Questions are grounded in real professional CS2 match data pulled live from the Skybox EDGE API, with Claude AI used as a fallback when live data is insufficient. Members answer by clicking a button, scores are tracked across the season, and results from the previous day are posted automatically before each new question.

---

## Daily Flow

1. **09:00 UTC — Results post** — The bot posts a recap of the previous day's question: a bar chart showing how many players picked each option, the correct answer, and a brief explanation.
2. **Immediately after — New question** — A new multiple-choice question is posted with four answer options laid out in a 2×2 grid. If an event filter is active, the event name is shown beneath the question.
3. **Members click to answer** — Each member gets one attempt. Correct answers earn points; wrong answers break a streak. Feedback is shown privately (ephemeral) so the channel stays clean.

---

## Scoring

| Action | Points |
|---|---|
| Correct answer | +10 |
| Streak bonus (day 3+) | +2 per consecutive day |
| 🥇 Longest streak at season end | +50 |
| 🥈 2nd longest streak at season end | +30 |
| 🥉 3rd longest streak at season end | +10 |

Difficulty levels (Easy / Medium / Hard) are labelled on each question but do not affect the points awarded.

---

## Question Sources

- **Live match data (primary)** — The bot fetches recent CS2 public matches from the Skybox EDGE API, including team rosters, maps played, scores, and per-player statistics for **both teams** (kills, deaths, KAST, headshots, entry kills, damage, assists). Claude AI uses this data to generate a factual question grounded in a real match.
- **CS2 general knowledge (fallback)** — If live data is unavailable or too sparse, Claude generates a question from its knowledge of CS2 weapons, maps, pro players, tournaments, or game mechanics.

When no event filter is set, the bot draws from **matches played in the past 30 days**, randomly sampling from different time windows each day to keep questions varied.

## Question Categories

All category definitions live in a single file: **`questionCategories.ts`**. Editing that file is all that is needed to change what Claude asks about.

**Live-data categories** (require EDGE API match data):

| Category | What it asks |
|---|---|
| Top Fragger | Which player had the most kills in the match? |
| Map Result | What was the final score on a specific map? |
| Entry Specialist | Which player had the most entry kills (first-blood duels won)? |
| KAST Leader | Which player had the highest KAST% (consistency metric)? |
| Damage Dealer | Which player dealt the most total damage? |
| Headshot King | Which player had the most headshot kills? |
| Series Score | What was the overall series result (e.g. 2-1)? |
| Maps Played | Which map was played in game 1/2/3 of the series? |

**General knowledge categories** (fallback when no live data):
Weapons · Maps · Pro Players · Tournaments · Game Mechanics

---

## Slash Commands

### For all members

| Command | Description |
|---|---|
| `/leaderboard` | Shows the top 10 players for the current season, including points and active streaks. |
| `/stats` | Shows your personal stats: total points, current streak, longest streak, questions answered, correct answers, and accuracy percentage. |
| `/season` | Shows the current season status: which event filter is active (if any) and how season-end bonuses work. |

### For server administrators only

| Command | Description |
|---|---|
| `/posttrivia` | Manually triggers today's trivia post immediately. If a question has already been posted today, it is replaced with a freshly generated one. |
| `/setevent [event]` | Filters all future questions to a specific CS2 event (e.g. PGL Bucharest 2026). Start typing to search — the bot shows a live autocomplete list of available events from the EDGE API. |
| `/clearevent` | Removes the event filter. Questions return to drawing from the full 30-day pool of all public CS2 matches. |
| `/endseason` | Ends the current season: awards streak bonuses to the top 3 players by longest streak, then posts a final leaderboard. Points and streaks reset for the next season. |

---

## Technical Notes

- Questions and answers are stored in a PostgreSQL database. Each user's answer, streak, and points are persisted across sessions.
- The bot is always running alongside the API server — no manual startup required after deployment.
- All admin replies are ephemeral (private) by default to avoid cluttering the channel.
