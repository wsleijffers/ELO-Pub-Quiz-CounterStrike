import {
  EmbedBuilder,
  ButtonInteraction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  AutocompleteInteraction,
  Interaction,
} from "discord.js";
import { logger } from "../logger";
import { fetchAllEvents, EventEntry } from "./edgeApi";
import {
  getActiveEvent,
  setActiveEvent,
  clearActiveEvent,
  getLeaderboard,
  getUserStats,
  getTodayQuestion,
  recordCorrectAnswer,
  recordWrongAnswer,
  hasUserAnswered,
  applySeasonEndBonuses,
  resetTodayQuestion,
} from "./database";
import { postDailyTrivia } from "./trivia";

// ---------------------------------------------------------------------------
// Event cache — full list of all EDGE API events, refreshed every 60 minutes.
// Populated at bot startup by calling warmEventCache(). Autocomplete searches
// this in-memory list so users can find any event, not just the first 25.
// ---------------------------------------------------------------------------

const EVENT_CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

let eventCache: EventEntry[] = [];
let cacheRefreshTimer: ReturnType<typeof setInterval> | null = null;

async function refreshEventCache(): Promise<void> {
  try {
    const entries = await fetchAllEvents();
    eventCache = entries;
    logger.info({ count: entries.length }, "Event cache refreshed");
  } catch (err) {
    logger.warn({ err }, "Failed to refresh event cache — keeping existing entries");
  }
}

/**
 * Warms the full event cache on bot startup and schedules a refresh every
 * 60 minutes. Safe to call multiple times (idempotent).
 */
export async function warmEventCache(): Promise<void> {
  await refreshEventCache();

  if (!cacheRefreshTimer) {
    cacheRefreshTimer = setInterval(() => {
      void refreshEventCache();
    }, EVENT_CACHE_TTL_MS);
  }
}

function getCachedEvents(): EventEntry[] {
  return eventCache;
}

// ---------------------------------------------------------------------------

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction);
  } else if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
  } else if (interaction.isChatInputCommand()) {
    await handleSlashCommand(interaction);
  } else if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
  }
}

async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (interaction.commandName !== "setevent") return;

  const focused = interaction.options.getFocused().toLowerCase().trim();

  try {
    const events = getCachedEvents();

    const matches = events
      .filter((e) => !focused || e.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((e) => ({ name: e.name, value: e.name }));

    logger.debug({ focused, matchCount: matches.length, totalCached: events.length }, "Autocomplete responding");
    await interaction.respond(matches);
  } catch (err) {
    logger.error({ err }, "Autocomplete handler failed");
    await interaction.respond([]);
  }
}

async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const { customId, user } = interaction;
  if (!customId.startsWith("trivia_answer_")) return;

  const parts = customId.split("_");
  const chosenAnswer = parts[2];
  const date = parts[3];

  if (!chosenAnswer || !date) return;

  const question = await getTodayQuestion();
  if (!question || question.id !== date) {
    await interaction.reply({ content: "⚠️ This trivia question has expired.", ephemeral: true });
    return;
  }

  const existing = await hasUserAnswered(user.id, date);
  if (existing) {
    const isCorrect = existing.isCorrect;
    await interaction.reply({
      content: isCorrect
        ? `✅ You already answered correctly! Nice work.`
        : `❌ You already answered this one incorrectly. Better luck tomorrow!`,
      ephemeral: true,
    });
    return;
  }

  const isCorrect = chosenAnswer === question.correctAnswer;
  const difficulty = question.difficulty ?? "medium";

  if (isCorrect) {
    const result = await recordCorrectAnswer(user.id, user.username, difficulty, date, chosenAnswer);
    const diffEmoji: Record<string, string> = { easy: "🟢", medium: "🟡", hard: "🔴" };

    let streakMsg = "";
    if (result.currentStreak >= 7) {
      streakMsg = `\n🔥 **${result.currentStreak}-day streak!** You're on fire!`;
    } else if (result.currentStreak >= 3) {
      streakMsg = `\n🔥 ${result.currentStreak}-day streak! Keep it going!`;
    }

    const bonusMsg = result.streakBonus > 0 ? ` (+${result.streakBonus} streak bonus)` : "";

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ Correct!")
          .setDescription(
            `Nice one, **${user.username}**! You earned **+${result.pointsEarned} points** ${diffEmoji[difficulty] ?? "🟡"} ${difficulty}${bonusMsg}.\n` +
              `🏅 Total: **${result.totalPoints} pts** · 🔥 Streak: **${result.currentStreak} day${result.currentStreak !== 1 ? "s" : ""}**` +
              streakMsg
          )
          .setColor(0x57f287)
          .setFooter({ text: "Use /stats to see your full profile" }),
      ],
      ephemeral: true,
    });
  } else {
    const result = await recordWrongAnswer(user.id, user.username, date, chosenAnswer);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("❌ Wrong answer")
          .setDescription(
            `Not quite, **${user.username}**. Your streak has been reset.\n` +
              `🏅 Total points: **${result.totalPoints} pts** · The correct answer: **${question.correctAnswer}**\n` +
              `💡 ${question.explanation}`
          )
          .setColor(0xed4245)
          .setFooter({ text: "Use /stats to see your full profile" }),
      ],
      ephemeral: true,
    });
  }
}

async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName } = interaction;
  if (commandName === "leaderboard") await handleLeaderboard(interaction);
  else if (commandName === "stats") await handleStats(interaction);
  else if (commandName === "season") await handleSeason(interaction);
  else if (commandName === "endseason") await handleEndSeason(interaction);
  else if (commandName === "posttrivia") await handlePostTrivia(interaction);
  else if (commandName === "setevent") await handleSetEvent(interaction);
  else if (commandName === "clearevent") await handleClearEvent(interaction);
}

async function handleLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  const leaders = await getLeaderboard(10);

  if (leaders.length === 0) {
    await interaction.reply({ content: "No scores yet — answer today's trivia to get on the board!", ephemeral: true });
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  const rows = leaders.map((user, i) => {
    const medal = medals[i] ?? `**${i + 1}.**`;
    const streak = user.currentStreak > 0 ? ` 🔥 ${user.currentStreak}` : "";
    return `${medal} **${user.username}** — ${user.totalPoints} pts${streak}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("🏆 Season Leaderboard")
    .setDescription(rows.join("\n"))
    .addFields({
      name: "Scoring",
      value: "✅ +10 pts per correct answer · 🔥 +2 pts per streak day (from day 3+)\n🏆 Season-end bonus for top 3 longest streaks: 50 / 30 / 10 pts",
    })
    .setColor(0xe8a838)
    .setFooter({ text: "Use /stats to see your personal stats" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
  const stats = await getUserStats(interaction.user.id);

  if (!stats) {
    await interaction.reply({ content: "You haven't answered any trivia questions yet. Get started today!", ephemeral: true });
    return;
  }

  const accuracy =
    stats.totalAnswered > 0 ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100) : 0;

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${stats.username}'s Trivia Stats`)
    .addFields(
      { name: "🏅 Total Points", value: `${stats.totalPoints}`, inline: true },
      { name: "🔥 Current Streak", value: `${stats.currentStreak} days`, inline: true },
      { name: "⚡ Longest Streak", value: `${stats.longestStreak} days`, inline: true },
      { name: "✅ Correct", value: `${stats.totalCorrect}`, inline: true },
      { name: "📝 Answered", value: `${stats.totalAnswered}`, inline: true },
      { name: "🎯 Accuracy", value: `${accuracy}%`, inline: true }
    )
    .setColor(0x5865f2)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleSeason(interaction: ChatInputCommandInteraction): Promise<void> {
  const activeEvent = await getActiveEvent();
  const embed = new EmbedBuilder()
    .setTitle("🗓️ Season Info")
    .setDescription(
      activeEvent
        ? `The trivia season is currently filtering to **${activeEvent}**.\nQuestions pull from real match data for this event.`
        : "Trivia questions are pulling from **all CS2 events** in the EDGE API."
    )
    .addFields({
      name: "🏆 Season Bonuses",
      value: "🥇 Longest streak: +50 pts\n🥈 2nd longest: +30 pts\n🥉 3rd longest: +10 pts",
    })
    .setColor(0xe8a838)
    .setFooter({ text: "Use /leaderboard to see current standings" });

  await interaction.reply({ embeds: [embed] });
}

async function handleEndSeason(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !("permissions" in member) || !(member.permissions as { has: (p: string) => boolean }).has("Administrator")) {
    await interaction.reply({ content: "⛔ Only server administrators can end the season.", ephemeral: true });
    return;
  }

  await interaction.deferReply();
  const bonusRecipients = await applySeasonEndBonuses();

  if (bonusRecipients.length === 0) {
    await interaction.editReply("No players have streak data to award bonuses to.");
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  const bonusLines = bonusRecipients.map(
    (r) =>
      `${medals[r.rank - 1] ?? `**${r.rank}.**`} **${r.username}** — longest streak: **${r.longestStreak} days** → **+${r.bonus} pts** (Total: ${r.finalPoints} pts)`
  );

  const leaderboard = await getLeaderboard(10);
  const leaderLines = leaderboard.map((u, i) => {
    const medal = medals[i] ?? `**${i + 1}.**`;
    return `${medal} **${u.username}** — ${u.totalPoints} pts`;
  });

  const embed = new EmbedBuilder()
    .setTitle("🏁 Season Over")
    .setDescription("The season has ended! Streak bonuses have been awarded. 🎉")
    .addFields(
      { name: "⚡ Streak Bonuses Awarded", value: bonusLines.join("\n") },
      { name: "🏆 Final Standings", value: leaderLines.join("\n") }
    )
    .setColor(0xe8a838)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleSetEvent(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !("permissions" in member) || !(member.permissions as { has: (p: string) => boolean }).has("Administrator")) {
    await interaction.reply({ content: "⛔ Only server administrators can change the event filter.", ephemeral: true });
    return;
  }

  const eventName = interaction.options.getString("event", true);

  await setActiveEvent(eventName);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("📅 Event Filter Set")
        .setDescription(`Trivia questions will now be filtered to:\n\n**${eventName}**\n\nUse \`/clearevent\` to go back to all events.`)
        .setColor(0x57f287),
    ],
    ephemeral: true,
  });
}

async function handleClearEvent(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !("permissions" in member) || !(member.permissions as { has: (p: string) => boolean }).has("Administrator")) {
    await interaction.reply({ content: "⛔ Only server administrators can change the event filter.", ephemeral: true });
    return;
  }

  await clearActiveEvent();

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("🌐 Event Filter Cleared")
        .setDescription("Trivia questions will now pull from **all CS2 events** in the EDGE API.\n\nUse `/setevent` to filter to a specific event.")
        .setColor(0x5865f2),
    ],
    ephemeral: true,
  });
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.customId !== "select_event") return;

  const member = interaction.member;
  if (!member || !("permissions" in member) || !(member.permissions as { has: (p: string) => boolean }).has("Administrator")) {
    await interaction.reply({ content: "⛔ Only server administrators can change the event filter.", ephemeral: true });
    return;
  }

  const selectedEvent = interaction.values[0];
  if (!selectedEvent) return;

  await setActiveEvent(selectedEvent);

  await interaction.update({
    content: null,
    embeds: [
      new EmbedBuilder()
        .setTitle("📅 Event Filter Set")
        .setDescription(`Trivia questions will now be filtered to:\n\n**${selectedEvent}**\n\nUse \`/clearevent\` to go back to all events.`)
        .setColor(0x57f287),
    ],
    components: [],
  });
}

async function handlePostTrivia(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !("permissions" in member) || !(member.permissions as { has: (p: string) => boolean }).has("Administrator")) {
    await interaction.reply({ content: "⛔ Only server administrators can manually post trivia.", ephemeral: true });
    return;
  }

  const existing = await getTodayQuestion();
  const isOverride = existing !== null;

  if (isOverride) {
    await resetTodayQuestion();
  }

  await interaction.reply({
    content: isOverride
      ? "⏳ Overriding today's question — generating a fresh one, please wait..."
      : "⏳ Generating today's trivia question, please wait...",
    ephemeral: true,
  });

  try {
    const channel = interaction.channel;
    if (!channel || !("send" in channel)) {
      await interaction.editReply("❌ Cannot post to this channel type.");
      return;
    }
    await postDailyTrivia(channel as Parameters<typeof postDailyTrivia>[0]);
    await interaction.editReply(`✅ Trivia question posted successfully!`);
  } catch (err) {
    logger.error({ err }, "/posttrivia failed");
    await interaction.editReply("❌ Failed to generate the trivia question. Check the bot logs for details.");
  }
}
