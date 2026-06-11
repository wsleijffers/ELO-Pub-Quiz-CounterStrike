import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  AutocompleteInteraction,
  Interaction,
  TextChannel,
} from "discord.js";
import { logger } from "../logger";
import { fetchAllEvents, fetchTeamsFromRecentMatches, EventEntry } from "./edgeApi";
import { QUESTION_CATEGORIES } from "./questionCategories";
import {
  getActiveEvent,
  setActiveEvent,
  clearActiveEvent,
  getActiveTeam,
  setActiveTeam,
  clearActiveTeam,
  getActiveCategory,
  setActiveCategory,
  clearActiveCategory,
  getAutoPostEnabled,
  setAutoPostEnabled,
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
// Team cache — unique team names from recent public matches, refreshed every
// 60 minutes. Populated at startup by warmTeamCache().
// ---------------------------------------------------------------------------

let teamCache: string[] = [];
let teamCacheRefreshTimer: ReturnType<typeof setInterval> | null = null;

async function refreshTeamCache(): Promise<void> {
  try {
    const teams = await fetchTeamsFromRecentMatches(15);
    teamCache = teams;
    logger.info({ count: teams.length }, "Team cache refreshed");
  } catch (err) {
    logger.warn({ err }, "Failed to refresh team cache — keeping existing entries");
  }
}

export async function warmTeamCache(): Promise<void> {
  await refreshTeamCache();

  if (!teamCacheRefreshTimer) {
    teamCacheRefreshTimer = setInterval(() => {
      void refreshTeamCache();
    }, EVENT_CACHE_TTL_MS);
  }
}

function getCachedTeams(): string[] {
  return teamCache;
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
  const focused = interaction.options.getFocused().toLowerCase().trim();

  try {
    if (interaction.commandName === "setevent") {
      const events = getCachedEvents();
      const matches = events
        .filter((e) => !focused || e.name.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((e) => ({ name: e.name, value: e.name }));
      logger.debug({ focused, matchCount: matches.length, totalCached: events.length }, "Event autocomplete responding");
      await interaction.respond(matches);

    } else if (interaction.commandName === "setteam") {
      const teams = getCachedTeams();
      const matches = teams
        .filter((t) => !focused || t.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((t) => ({ name: t, value: t }));
      logger.debug({ focused, matchCount: matches.length, totalCached: teams.length }, "Team autocomplete responding");
      await interaction.respond(matches);

    } else if (interaction.commandName === "setcategory") {
      const matches = QUESTION_CATEGORIES
        .filter((c) => !focused || c.label.toLowerCase().includes(focused) || c.id.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((c) => ({ name: c.label, value: c.id }));
      await interaction.respond(matches);

    } else if (interaction.commandName === "postquestion") {
      const focusedOption = interaction.options.getFocused(true);

      if (focusedOption.name === "setcategory") {
        const matches = QUESTION_CATEGORIES
          .filter((c) => !focused || c.label.toLowerCase().includes(focused) || c.id.toLowerCase().includes(focused))
          .slice(0, 25)
          .map((c) => ({ name: c.label, value: c.id }));
        await interaction.respond(matches);

      } else if (focusedOption.name === "setevent") {
        const events = getCachedEvents();
        const matches = events
          .filter((e) => !focused || e.name.toLowerCase().includes(focused))
          .slice(0, 25)
          .map((e) => ({ name: e.name, value: e.name }));
        await interaction.respond(matches);

      } else if (focusedOption.name === "setteam") {
        const teams = getCachedTeams();
        const matches = teams
          .filter((t) => !focused || t.toLowerCase().includes(focused))
          .slice(0, 25)
          .map((t) => ({ name: t, value: t }));
        await interaction.respond(matches);
      }
    }
  } catch (err) {
    logger.error({ err }, "Autocomplete handler failed");
    await interaction.respond([]);
  }
}

// ---------------------------------------------------------------------------
// Settings embed builder — shared by /quizsettings and all settings buttons
// ---------------------------------------------------------------------------

async function buildSettingsComponents(): Promise<{
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
}> {
  const [activeEvent, activeTeam, activeCategory, todayQuestion, autoPostEnabled] = await Promise.all([
    getActiveEvent(),
    getActiveTeam(),
    getActiveCategory(),
    getTodayQuestion(),
    getAutoPostEnabled(),
  ]);

  const channelId = process.env.DISCORD_CHANNEL_ID;
  const channelValue = channelId ? `<#${channelId}>` : "⚠️ Not configured (`DISCORD_CHANNEL_ID` not set)";

  const categoryLabel = activeCategory
    ? (QUESTION_CATEGORIES.find((c) => c.id === activeCategory)?.label ?? activeCategory)
    : null;

  let todayValue: string;
  if (todayQuestion) {
    const tCatLabel = QUESTION_CATEGORIES.find((c) => c.id === todayQuestion.category)?.label ?? todayQuestion.category;
    const sourceLabel = todayQuestion.source === "edge" ? "Skybox Edge Data" : "CS2 Wiki";
    todayValue = `✅ Posted\n**${tCatLabel}** · **${sourceLabel}** · **${todayQuestion.difficulty}**`;
  } else {
    todayValue = "⏳ Not yet posted today";
  }

  let modeValue: string;
  if (activeEvent && activeTeam) {
    modeValue = `Event-aggregate for **${activeEvent}**, restricted to **${activeTeam}**`;
  } else if (activeEvent) {
    modeValue = `Event-aggregate for **${activeEvent}** (all teams)`;
  } else if (activeTeam) {
    modeValue = `Recent match mode, filtered to **${activeTeam}**`;
  } else {
    modeValue = "Recent match mode — no filters (all events & teams)";
  }

  const autoPostValue = autoPostEnabled
    ? "✅ Active — posts at 09:00 UTC daily"
    : "⏸ Paused — use Post Now or /postquestion to post manually";

  const embed = new EmbedBuilder()
    .setTitle("⚙️ Bot Settings")
    .setColor(0x5865f2)
    .addFields(
      { name: "📅 Event", value: activeEvent ?? "—", inline: true },
      { name: "🎯 Team", value: activeTeam ?? "—", inline: true },
      { name: "📂 Category", value: categoryLabel ?? "—", inline: true },
      { name: "📡 Data Mode", value: modeValue },
      { name: "📺 Trivia Channel", value: channelValue, inline: true },
      { name: "🕘 Daily Post Time", value: "09:00 UTC", inline: true },
      { name: "📝 Today's Question", value: todayValue },
      { name: "🤖 Auto-Post", value: autoPostValue },
    )
    .setTimestamp();

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("settings_clear_event")
      .setLabel("Clear Event")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("settings_clear_team")
      .setLabel("Clear Team")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("settings_clear_category")
      .setLabel("Clear Category")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("settings_clear_all")
      .setLabel("Clear All Filters")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("settings_toggle_autopost")
      .setLabel(autoPostEnabled ? "Pause Auto-Post" : "Resume Auto-Post")
      .setEmoji(autoPostEnabled ? "⏸️" : "▶️")
      .setStyle(autoPostEnabled ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("settings_post_now")
      .setLabel("Post Now")
      .setEmoji("📣")
      .setStyle(ButtonStyle.Primary),
  );

  return { embed, components: [row1, row2] };
}

async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const { customId, user } = interaction;

  // ── Settings panel buttons ──────────────────────────────────────────────────
  if (customId.startsWith("settings_")) {
    const member = interaction.member;
    if (!member || !("permissions" in member) || !(member.permissions as { has: (p: string) => boolean }).has("Administrator")) {
      await interaction.reply({ content: "⛔ Only server administrators can change bot settings.", ephemeral: true });
      return;
    }

    if (customId === "settings_clear_event") {
      await clearActiveEvent();
      const { embed, components } = await buildSettingsComponents();
      await interaction.update({ embeds: [embed], components });
      return;
    }

    if (customId === "settings_clear_team") {
      await clearActiveTeam();
      const { embed, components } = await buildSettingsComponents();
      await interaction.update({ embeds: [embed], components });
      return;
    }

    if (customId === "settings_clear_category") {
      await clearActiveCategory();
      const { embed, components } = await buildSettingsComponents();
      await interaction.update({ embeds: [embed], components });
      return;
    }

    if (customId === "settings_clear_all") {
      await Promise.all([clearActiveEvent(), clearActiveTeam(), clearActiveCategory()]);
      const { embed, components } = await buildSettingsComponents();
      await interaction.update({ embeds: [embed], components });
      return;
    }

    if (customId === "settings_toggle_autopost") {
      const current = await getAutoPostEnabled();
      await setAutoPostEnabled(!current);
      const { embed, components } = await buildSettingsComponents();
      await interaction.update({ embeds: [embed], components });
      return;
    }

    if (customId === "settings_post_now") {
      await interaction.deferUpdate();
      const channelId = process.env.DISCORD_CHANNEL_ID;
      if (!channelId) {
        await interaction.followUp({ content: "❌ `DISCORD_CHANNEL_ID` is not configured.", ephemeral: true });
        return;
      }
      const channel = interaction.client.channels.cache.get(channelId) as TextChannel | undefined;
      if (!channel) {
        await interaction.followUp({ content: "❌ Trivia channel not found — check `DISCORD_CHANNEL_ID`.", ephemeral: true });
        return;
      }
      try {
        const existing = await getTodayQuestion();
        if (existing) {
          await resetTodayQuestion();
        }
        await postDailyTrivia(channel);
        const { embed, components } = await buildSettingsComponents();
        await interaction.editReply({ embeds: [embed], components });
        await interaction.followUp({ content: "✅ Trivia question posted!", ephemeral: true });
      } catch (err) {
        logger.error({ err }, "settings_post_now failed");
        await interaction.followUp({ content: "❌ Failed to post the trivia question. Check bot logs.", ephemeral: true });
      }
      return;
    }

    return;
  }

  // ── Trivia answer buttons ───────────────────────────────────────────────────
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
  else if (commandName === "postquestion") await handlePostQuestion(interaction);
  else if (commandName === "setevent") await handleSetEvent(interaction);
  else if (commandName === "setteam") await handleSetTeam(interaction);
  else if (commandName === "setcategory") await handleSetCategory(interaction);
  else if (commandName === "quizsettings") await handleSettings(interaction);
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
  const [activeEvent, activeTeam] = await Promise.all([getActiveEvent(), getActiveTeam()]);

  let filterDesc: string;
  if (activeEvent && activeTeam) {
    filterDesc = `Questions are filtered to **${activeTeam}** matches within **${activeEvent}**.`;
  } else if (activeEvent) {
    filterDesc = `Questions are filtered to the event **${activeEvent}**.\nAll teams within that event are included.`;
  } else if (activeTeam) {
    filterDesc = `Questions are filtered to matches involving **${activeTeam}**.\nAll events are included.`;
  } else {
    filterDesc = "Questions are pulling from **all CS2 events and teams** in the EDGE API.";
  }

  const embed = new EmbedBuilder()
    .setTitle("🗓️ Season Info")
    .setDescription(filterDesc)
    .addFields(
      {
        name: "⚙️ Active Filters",
        value: [
          `Event: ${activeEvent ? `**${activeEvent}**` : "none"}`,
          `Team: ${activeTeam ? `**${activeTeam}**` : "none"}`,
        ].join("\n"),
      },
      {
        name: "🏆 Season Bonuses",
        value: "🥇 Longest streak: +50 pts\n🥈 2nd longest: +30 pts\n🥉 3rd longest: +10 pts",
      }
    )
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
        .setDescription(`Trivia questions will now be filtered to:\n\n**${eventName}**\n\nUse \`/quizsettings\` → Clear Event to remove this filter.`)
        .setColor(0x57f287),
    ],
    ephemeral: true,
  });
}

async function handleSetTeam(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !("permissions" in member) || !(member.permissions as { has: (p: string) => boolean }).has("Administrator")) {
    await interaction.reply({ content: "⛔ Only server administrators can change the team filter.", ephemeral: true });
    return;
  }

  const teamName = interaction.options.getString("team", true);
  await setActiveTeam(teamName);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("🎯 Team Filter Set")
        .setDescription(`Trivia questions will now focus on matches involving:\n\n**${teamName}**\n\nUse \`/quizsettings\` → Clear Team to remove this filter, or \`/season\` to see all active filters.`)
        .setColor(0x57f287),
    ],
    ephemeral: true,
  });
}

async function handleSetCategory(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !("permissions" in member) || !(member.permissions as { has: (p: string) => boolean }).has("Administrator")) {
    await interaction.reply({ content: "⛔ Only server administrators can change the category override.", ephemeral: true });
    return;
  }

  const categoryId = interaction.options.getString("category", true);
  const categoryEntry = QUESTION_CATEGORIES.find((c) => c.id === categoryId);
  if (!categoryEntry) {
    await interaction.reply({ content: `❌ Unknown category: \`${categoryId}\`. Use autocomplete to pick a valid one.`, ephemeral: true });
    return;
  }

  await setActiveCategory(categoryId);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("📂 Category Override Set")
        .setDescription(`Daily trivia questions will now always use:\n\n**${categoryEntry.label}**\n\nThis overrides the automatic day-rotation. Use \`/quizsettings\` → Clear Category to return to rotation.`)
        .setColor(0x57f287),
    ],
    ephemeral: true,
  });
}

async function handleSettings(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !("permissions" in member) || !(member.permissions as { has: (p: string) => boolean }).has("Administrator")) {
    await interaction.reply({ content: "⛔ Only server administrators can view bot settings.", ephemeral: true });
    return;
  }

  const { embed, components } = await buildSettingsComponents();
  await interaction.reply({ embeds: [embed], components, ephemeral: true });
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
        .setDescription(`Trivia questions will now be filtered to:\n\n**${selectedEvent}**\n\nUse \`/quizsettings\` → Clear Event to remove this filter.`)
        .setColor(0x57f287),
    ],
    components: [],
  });
}

async function handlePostQuestion(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !("permissions" in member) || !(member.permissions as { has: (p: string) => boolean }).has("Administrator")) {
    await interaction.reply({ content: "⛔ Only server administrators can manually post trivia.", ephemeral: true });
    return;
  }

  // Read one-shot overrides — null means "not provided, use global setting"
  const categoryOverride = interaction.options.getString("setcategory") ?? null;
  const eventOverride = interaction.options.getString("setevent") ?? null;
  const teamOverride = interaction.options.getString("setteam") ?? null;

  const existing = await getTodayQuestion();
  const isOverride = existing !== null;

  if (isOverride) {
    await resetTodayQuestion();
  }

  // Build a human-readable summary of the active overrides for the reply
  const overrideParts: string[] = [];
  if (categoryOverride) overrideParts.push(`category: **${categoryOverride}**`);
  if (eventOverride) overrideParts.push(`event: **${eventOverride}**`);
  if (teamOverride) overrideParts.push(`team: **${teamOverride}**`);
  const overrideSummary = overrideParts.length > 0 ? ` (overrides: ${overrideParts.join(", ")})` : "";

  await interaction.reply({
    content: isOverride
      ? `⏳ Overriding today's question — generating a fresh one${overrideSummary}, please wait...`
      : `⏳ Generating today's trivia question${overrideSummary}, please wait...`,
    ephemeral: true,
  });

  try {
    const channel = interaction.channel;
    if (!channel || !("send" in channel)) {
      await interaction.editReply("❌ Cannot post to this channel type.");
      return;
    }
    await postDailyTrivia(channel as Parameters<typeof postDailyTrivia>[0], {
      categoryOverride,
      eventOverride,
      teamOverride,
    });
    await interaction.editReply(`✅ Trivia question posted successfully!${overrideSummary}`);
  } catch (err) {
    logger.error({ err }, "/postquestion failed");
    await interaction.editReply("❌ Failed to generate the trivia question. Check the bot logs for details.");
  }
}
