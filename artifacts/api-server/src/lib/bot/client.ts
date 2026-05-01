import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import cron from "node-cron";
import { logger } from "../logger";
import { handleInteraction, warmEventCache } from "./interactions";
import { postDailyTrivia } from "./trivia";
import { deployCommands } from "./deployCommands";
import { getTodayQuestion } from "./database";

let botClient: Client | null = null;

export async function startBot(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!token) {
    logger.warn("DISCORD_TOKEN not set — Discord bot will not start");
    return;
  }

  if (!channelId) {
    logger.warn("DISCORD_CHANNEL_ID not set — Discord bot will not start");
    return;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  client.on("ready", async () => {
    logger.info({ tag: client.user?.tag }, "Discord bot logged in");

    // Deploy slash commands on startup
    try {
      await deployCommands();
    } catch (err) {
      logger.error({ err }, "Failed to deploy slash commands");
    }

    // Warm the full event cache in the background — doesn't block startup.
    // Also schedules an automatic refresh every 60 minutes.
    void warmEventCache();

    // Schedule daily trivia at 9:00 AM UTC
    cron.schedule("0 9 * * *", async () => {
      try {
        const channel = client.channels.cache.get(channelId) as TextChannel | undefined;
        if (!channel) {
          logger.error({ channelId }, "Trivia channel not found");
          return;
        }

        const today = new Date().toISOString().split("T")[0];
        const existing = await getTodayQuestion();
        if (existing && existing.id === today) {
          logger.info({ date: today }, "Trivia already posted today, skipping cron");
          return;
        }

        await postDailyTrivia(channel);
      } catch (err) {
        logger.error({ err }, "Failed to post scheduled trivia");
      }
    });

    logger.info("Daily trivia scheduled for 09:00 UTC");
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      await handleInteraction(interaction);
    } catch (err) {
      logger.error({ err }, "Error handling Discord interaction");
    }
  });

  client.on("error", (err) => {
    logger.error({ err }, "Discord client error");
  });

  await client.login(token);
  botClient = client;
}

export function getBotClient(): Client | null {
  return botClient;
}
