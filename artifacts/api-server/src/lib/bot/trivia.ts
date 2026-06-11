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
import { generateDailyQuestion, QuestionOverrides } from "./questionGenerator";
import { saveQuestion, updateQuestionMessageId, getPreviousQuestion, getAnswerDistribution, getActiveEvent, getActiveTeam } from "./database";
import { QUESTION_CATEGORIES } from "./questionCategories";

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

  const labels: Record<string, string> = { A: "🇦", B: "🇧", C: "🇨", D: "🇩" };

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

export async function postDailyTrivia(channel: PostableChannel, overrides?: QuestionOverrides): Promise<void> {
  // Post yesterday's results first (if any)
  await postPreviousResults(channel);

  logger.info({ overrides }, "Generating daily trivia question...");
  const question = await generateDailyQuestion(overrides);
  const today = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // Resolve the effective event/team for display — override wins, then global, then null
  const [globalEvent, globalTeam] = await Promise.all([getActiveEvent(), getActiveTeam()]);
  const effectiveEvent = overrides?.eventOverride ?? globalEvent;
  const effectiveTeam = overrides?.teamOverride ?? globalTeam;

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
    activeEvent: effectiveEvent,
  });

  const diffColor = DIFFICULTY_COLORS[question.difficulty] ?? 0x5865f2;
  const diffEmoji = DIFFICULTY_EMOJIS[question.difficulty] ?? "🟡";

  // Build description with any active filters shown
  const contextLines: string[] = [];
  if (effectiveEvent) contextLines.push(`📅 *${effectiveEvent}*`);
  if (effectiveTeam) contextLines.push(`🎯 *${effectiveTeam}*`);
  const description = contextLines.length > 0
    ? `${question.question}\n\n${contextLines.join("  ·  ")}`
    : question.question;

  // 2×2 grid: Discord fills inline fields 3 per row, so we add an invisible
  // spacer as the 3rd slot to force A+B on row 1 and C+D on row 2.
  const SPACER = { name: "\u200b", value: "\u200b", inline: true as const };

  const embed = new EmbedBuilder()
    .setTitle(`🎯 Daily CS2 Trivia — ${today}`)
    .setDescription(description)
    .addFields(
      { name: "🇦", value: question.options.A, inline: true },
      { name: "🇧", value: question.options.B, inline: true },
      SPACER,
      { name: "🇨", value: question.options.C, inline: true },
      { name: "🇩", value: question.options.D, inline: true },
      SPACER,
    )
    .setColor(diffColor)
    .setFooter({
      text: [
        `${diffEmoji} ${question.difficulty.charAt(0).toUpperCase() + question.difficulty.slice(1)}`,
        `📂 ${QUESTION_CATEGORIES.find((c) => c.id === question.category)?.label ?? question.category}`,
        `Source: ${question.source === "edge" ? "Skybox Edge Data" : "CS2 Wiki"}`,
        `Use /leaderboard to see standings`,
      ].join("  ·  "),
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
