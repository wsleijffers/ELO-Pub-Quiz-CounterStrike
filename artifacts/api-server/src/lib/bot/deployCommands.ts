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
    .setName("posttrivia")
    .setDescription("[Admin] Manually post today's trivia question"),
  new SlashCommandBuilder()
    .setName("setevent")
    .setDescription("[Admin] Filter trivia to a specific CS2 event"),
  new SlashCommandBuilder()
    .setName("clearevent")
    .setDescription("[Admin] Remove event filter and use all events"),
].map((cmd) => cmd.toJSON());

export async function deployCommands(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!token || !clientId) {
    throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set");
  }

  const rest = new REST({ version: "10" }).setToken(token);

  logger.info("Deploying global slash commands...");
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  logger.info({ count: commands.length }, "Global slash commands deployed");
}
