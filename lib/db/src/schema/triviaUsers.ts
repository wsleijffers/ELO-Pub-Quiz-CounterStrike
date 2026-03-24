import { pgTable, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const triviaUsersTable = pgTable("trivia_users", {
  discordId: text("discord_id").primaryKey(),
  username: text("username").notNull(),
  totalPoints: integer("total_points").notNull().default(0),
  totalCorrect: integer("total_correct").notNull().default(0),
  totalAnswered: integer("total_answered").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastAnsweredAt: timestamp("last_answered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTriviaUserSchema = createInsertSchema(triviaUsersTable).omit({ createdAt: true, updatedAt: true });
export type InsertTriviaUser = z.infer<typeof insertTriviaUserSchema>;
export type TriviaUser = typeof triviaUsersTable.$inferSelect;
