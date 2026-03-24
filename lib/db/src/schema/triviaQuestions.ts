import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const triviaQuestionsTable = pgTable("trivia_questions", {
  id: text("id").primaryKey(), // YYYY-MM-DD
  question: text("question").notNull(),
  optionA: text("option_a").notNull(),
  optionB: text("option_b").notNull(),
  optionC: text("option_c").notNull(),
  optionD: text("option_d").notNull(),
  correctAnswer: text("correct_answer").notNull(), // A, B, C, or D
  explanation: text("explanation").notNull(),
  difficulty: text("difficulty").notNull().default("medium"), // easy, medium, hard
  source: text("source").notNull().default("wiki"), // edge or wiki
  category: text("category").notNull().default("general"),
  discordMessageId: text("discord_message_id"),
  activeEvent: text("active_event"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTriviaQuestionSchema = createInsertSchema(triviaQuestionsTable).omit({ createdAt: true });
export type InsertTriviaQuestion = z.infer<typeof insertTriviaQuestionSchema>;
export type TriviaQuestion = typeof triviaQuestionsTable.$inferSelect;
