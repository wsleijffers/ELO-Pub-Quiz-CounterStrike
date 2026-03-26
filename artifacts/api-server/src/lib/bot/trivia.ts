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
import { saveQuestion, updateQuestionMessageId, getPreviousQuestion, getAnswerDistribution } from "./database";

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

function renderBar(count: number, total: number, barWidth = 18): string {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const filled = Math.round((pct / 100) * barWidth);
  const empty = barWidth - filled;
  return `${"█".repeat(filled)}${"░".repeat(empty)}  ${pct}%`;
}

async function postPreviousResults(channel: PostableChannel): Promise<void> {
  const prev = await getPreviousQuestion();
  if (!prev) return;

  const dist = await getAnswerDistribution(prev.id);
  if (dist.total === 0) return; // no one answered, skip

  const options: Record<string, string> = {
    A: prev.optionA,
    B: prev.optionB,
    C: prev.optionC,
    D: prev.optionD,
  };

  const labels: Record<string, string> = { A: "🅰️", B: "🅱️", C: "🇨", D: "🇩" };

  const lines = (["A", "B", "C", "D"] as const).map((letter) => {
    const isCorrect = letter === prev.correctAnswer;
    const bar = renderBar(dist[letter], dist.total);
    const check = isCorrect ? " ✅" : "";
    return `${labels[letter]} **${letter}: ${options[letter]}**${check}\n\`${bar}\``;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📊 Yesterday's Results — ${prev.id}`)
    .setDescription(
      `**Q: ${prev.question}**\n\n` +
      lines.join("\n\n") +
      `\n\n✅ **Correct answer: ${prev.correctAnswer} — ${options[prev.correctAnswer] ?? ""}**` +
      `\n💡 ${prev.explanation}`
    )
    .addFields({ name: "Respondents", value: `${dist.total} player${dist.total !== 1 ? "s" : ""} answered`, inline: true })
    .setColor(0x5865f2)
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  logger.info({ questionId: prev.id, total: dist.total }, "Posted previous trivia results");
}

export async function postDailyTrivia(channel: PostableChannel): Promise<void> {
  // Post yesterday's results first (if any)
  await postPreviousResults(channel);

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
