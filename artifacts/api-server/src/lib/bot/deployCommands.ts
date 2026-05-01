import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { logger } from "../logger";

const commands = [
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the top 10 trivia players"),
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show your personal trivia stats"),
  new SlashCommandBuilder()
    .setName("season")
    .setDescription("Show current season info and active event filter"),
  new SlashCommandBuilder()
    .setName("endseason")
    .setDescription("[Admin] End the season and award streak bonuses"),
  new SlashCommandBuilder()
    .setName("postquestion")
    .setDescription("[Admin] Manually post today's trivia question")
    .addStringOption((option) =>
      option
        .setName("setcategory")
        .setDescription("Override question category for this post only")
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("setevent")
        .setDescription("Override event filter for this post only")
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("setteam")
        .setDescription("Override team filter for this post only")
        .setRequired(false)
        .setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName("setevent")
    .setDescription("[Admin] Filter trivia to a specific CS2 event")
    .addStringOption((option) =>
      option
        .setName("event")
        .setDescription("Start typing to search available events")
        .setRequired(true)
        .setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName("clearevent")
    .setDescription("[Admin] Remove event filter and use all events"),
  new SlashCommandBuilder()
    .setName("setteam")
    .setDescription("[Admin] Filter trivia questions to a specific team")
    .addStringOption((option) =>
      option
        .setName("team")
        .setDescription("Start typing to search teams active in the last 30 days")
        .setRequired(true)
        .setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName("clearteam")
    .setDescription("[Admin] Remove team filter and use all teams"),
].map((cmd) => cmd.toJSON());

export async function deployCommands(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !clientId) {
    throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set");
  }

  const rest = new REST({ version: "10" }).setToken(token);

  if (guildId) {
    // Clear any leftover global commands so there are no duplicates
    await rest.put(Routes.applicationCommands(clientId), { body: [] });

    // Guild commands propagate instantly — use for the primary server
    logger.info({ guildId }, "Deploying guild slash commands...");
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    logger.info({ count: commands.length }, "Guild slash commands deployed");
  } else {
    // Fall back to global commands if no guild ID is configured
    logger.info("Deploying global slash commands...");
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    logger.info({ count: commands.length }, "Global slash commands deployed");
  }
}
