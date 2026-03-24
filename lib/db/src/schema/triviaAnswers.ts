import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const triviaAnswersTable = pgTable("trivia_answers", {
  id: text("id").primaryKey(), // discordId_questionId
  discordId: text("discord_id").notNull(),
  questionId: text("question_id").notNull(), // YYYY-MM-DD
  answer: text("answer").notNull(), // A, B, C, or D
  isCorrect: boolean("is_correct").notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTriviaAnswerSchema = createInsertSchema(triviaAnswersTable);
export type InsertTriviaAnswer = z.infer<typeof insertTriviaAnswerSchema>;
export type TriviaAnswer = typeof triviaAnswersTable.$inferSelect;
