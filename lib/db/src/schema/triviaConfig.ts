import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const triviaConfigTable = pgTable("trivia_config", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTriviaConfigSchema = createInsertSchema(triviaConfigTable).omit({ updatedAt: true });
export type InsertTriviaConfig = z.infer<typeof insertTriviaConfigSchema>;
export type TriviaConfig = typeof triviaConfigTable.$inferSelect;
