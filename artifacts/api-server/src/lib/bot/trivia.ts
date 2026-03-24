import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  DMChannel,
  NewsChannel,
  ThreadChannel,
} from "discord.js";
import { logger } from "../logger";
import { generateDailyQuestion } from "./questionGenerator";
import { saveQuestion, updateQuestionMessageId } from "./database";

type PostableChannel = TextChannel | DMChannel | NewsChannel | ThreadChannel;

const DIFFICULTY_COLORS: Record<string, number> = {
  easy: 0x57f287,
  medium: 0xe8a838,
  hard: 0xed4245,
};

const DIFFICULTY_EMOJIS: Record<string, string> = {
  easy: "🟢",
  medium: "🟡",
  hard: "🔴",
};

export async function postDailyTrivia(channel: PostableChannel): Promise<void> {
  logger.info("Generating daily trivia question...");
  const question = await generateDailyQuestion();
  const today = new Date().toISOString().split("T")[0];

  await saveQuestion({
    id: today,
    question: question.question,
    optionA: question.options.A,
    optionB: question.options.B,
    optionC: question.options.C,
    optionD: question.options.D,
    correctAnswer: question.correct,
    explanation: question.explanation,
    difficulty: question.difficulty,
    source: question.source,
    category: question.category,
    activeEvent: null,
  });

  const diffColor = DIFFICULTY_COLORS[question.difficulty] ?? 0x5865f2;
  const diffEmoji = DIFFICULTY_EMOJIS[question.difficulty] ?? "🟡";

  const embed = new EmbedBuilder()
    .setTitle(`🎯 Daily CS2 Trivia — ${today}`)
    .setDescription(question.question)
    .addFields(
      { name: "🅰️ A", value: question.options.A, inline: true },
      { name: "🅱️ B", value: question.options.B, inline: true },
      { name: "🇨 C", value: question.options.C, inline: true },
      { name: "🇩 D", value: question.options.D, inline: true }
    )
    .setColor(diffColor)
    .setFooter({
      text: `${diffEmoji} ${question.difficulty.charAt(0).toUpperCase() + question.difficulty.slice(1)} · Source: ${question.source === "edge" ? "Live Match Data" : "CS2 Wiki"} · Use /leaderboard to see standings`,
    })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`trivia_answer_A_${today}`)
      .setLabel("A")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`trivia_answer_B_${today}`)
      .setLabel("B")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`trivia_answer_C_${today}`)
      .setLabel("C")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`trivia_answer_D_${today}`)
      .setLabel("D")
      .setStyle(ButtonStyle.Secondary)
  );

  const message = await channel.send({ embeds: [embed], components: [row] });
  await updateQuestionMessageId(today, message.id);
  logger.info({ messageId: message.id, date: today }, "Daily trivia posted");
}
