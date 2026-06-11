import { eq, desc, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  triviaUsersTable,
  triviaQuestionsTable,
  triviaAnswersTable,
  triviaConfigTable,
  type TriviaUser,
  type TriviaQuestion,
  type TriviaAnswer,
} from "@workspace/db";

const POINTS_CORRECT = 10;
const POINTS_STREAK_BONUS = 2;
const STREAK_BONUS_START = 3;

export async function getOrCreateUser(discordId: string, username: string): Promise<TriviaUser> {
  const [existing] = await db
    .select()
    .from(triviaUsersTable)
    .where(eq(triviaUsersTable.discordId, discordId));

  if (existing) return existing;

  const [created] = await db
    .insert(triviaUsersTable)
    .values({ discordId, username })
    .returning();

  return created;
}

export async function recordCorrectAnswer(
  discordId: string,
  username: string,
  difficulty: string,
  questionId: string,
  selectedAnswer: string
): Promise<{ pointsEarned: number; streakBonus: number; currentStreak: number; totalPoints: number }> {
  const user = await getOrCreateUser(discordId, username);

  const now = new Date();
  const lastDate = user.lastAnsweredAt
    ? new Date(user.lastAnsweredAt).toISOString().split("T")[0]
    : null;
  const today = now.toISOString().split("T")[0];

  let newStreak = 1;
  if (lastDate) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    if (lastDate === yesterdayStr) {
      newStreak = user.currentStreak + 1;
    } else if (lastDate === today) {
      newStreak = user.currentStreak;
    }
  }

  const streakBonus = newStreak >= STREAK_BONUS_START ? POINTS_STREAK_BONUS : 0;
  const pointsEarned = POINTS_CORRECT + streakBonus;
  const newLongest = Math.max(user.longestStreak, newStreak);
  const newTotal = user.totalPoints + pointsEarned;

  await db
    .update(triviaUsersTable)
    .set({
      username,
      totalPoints: newTotal,
      totalCorrect: user.totalCorrect + 1,
      totalAnswered: user.totalAnswered + 1,
      currentStreak: newStreak,
      longestStreak: newLongest,
      lastAnsweredAt: now,
    })
    .where(eq(triviaUsersTable.discordId, discordId));

  await db
    .insert(triviaAnswersTable)
    .values({
      id: `${discordId}_${questionId}`,
      discordId,
      questionId,
      answer: selectedAnswer,
      isCorrect: true,
    })
    .onConflictDoNothing();

  return { pointsEarned, streakBonus, currentStreak: newStreak, totalPoints: newTotal };
}

export async function recordWrongAnswer(
  discordId: string,
  username: string,
  questionId: string,
  selectedAnswer: string
): Promise<{ totalPoints: number }> {
  const user = await getOrCreateUser(discordId, username);

  await db
    .update(triviaUsersTable)
    .set({
      username,
      totalAnswered: user.totalAnswered + 1,
      currentStreak: 0,
    })
    .where(eq(triviaUsersTable.discordId, discordId));

  await db
    .insert(triviaAnswersTable)
    .values({
      id: `${discordId}_${questionId}`,
      discordId,
      questionId,
      answer: selectedAnswer,
      isCorrect: false,
    })
    .onConflictDoNothing();

  return { totalPoints: user.totalPoints };
}

export async function hasUserAnswered(discordId: string, questionId: string): Promise<TriviaAnswer | null> {
  const [answer] = await db
    .select()
    .from(triviaAnswersTable)
    .where(eq(triviaAnswersTable.id, `${discordId}_${questionId}`));
  return answer ?? null;
}

export async function getLeaderboard(limit = 10): Promise<TriviaUser[]> {
  return db
    .select()
    .from(triviaUsersTable)
    .orderBy(desc(triviaUsersTable.totalPoints))
    .limit(limit);
}

export async function getUserStats(discordId: string): Promise<TriviaUser | null> {
  const [user] = await db
    .select()
    .from(triviaUsersTable)
    .where(eq(triviaUsersTable.discordId, discordId));
  return user ?? null;
}

export async function resetTodayQuestion(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await db.delete(triviaAnswersTable).where(eq(triviaAnswersTable.questionId, today));
  await db.delete(triviaQuestionsTable).where(eq(triviaQuestionsTable.id, today));
}

export async function getTodayQuestion(): Promise<TriviaQuestion | null> {
  const today = new Date().toISOString().split("T")[0];
  const [question] = await db
    .select()
    .from(triviaQuestionsTable)
    .where(eq(triviaQuestionsTable.id, today));
  return question ?? null;
}

export async function getPreviousQuestion(): Promise<TriviaQuestion | null> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const [question] = await db
    .select()
    .from(triviaQuestionsTable)
    .where(eq(triviaQuestionsTable.id, yesterdayStr));
  return question ?? null;
}

export async function getAnswerDistribution(
  questionId: string
): Promise<{ A: number; B: number; C: number; D: number; total: number }> {
  const rows = await db
    .select({
      answer: triviaAnswersTable.answer,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(triviaAnswersTable)
    .where(eq(triviaAnswersTable.questionId, questionId))
    .groupBy(triviaAnswersTable.answer);

  const dist = { A: 0, B: 0, C: 0, D: 0, total: 0 };
  for (const row of rows) {
    const key = row.answer as "A" | "B" | "C" | "D";
    if (key in dist) {
      dist[key] = row.count;
      dist.total += row.count;
    }
  }
  return dist;
}

export async function saveQuestion(question: {
  id: string;
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  explanation: string;
  difficulty: string;
  source: string;
  category: string;
  activeEvent: string | null;
  discordMessageId?: string;
}): Promise<void> {
  await db
    .insert(triviaQuestionsTable)
    .values(question)
    .onConflictDoUpdate({
      target: triviaQuestionsTable.id,
      set: {
        question: question.question,
        optionA: question.optionA,
        optionB: question.optionB,
        optionC: question.optionC,
        optionD: question.optionD,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        difficulty: question.difficulty,
        source: question.source,
        category: question.category,
        activeEvent: question.activeEvent,
      },
    });
}

export async function updateQuestionMessageId(questionId: string, messageId: string): Promise<void> {
  await db
    .update(triviaQuestionsTable)
    .set({ discordMessageId: messageId })
    .where(eq(triviaQuestionsTable.id, questionId));
}

export async function getActiveEvent(): Promise<string | null> {
  const [cfg] = await db
    .select()
    .from(triviaConfigTable)
    .where(eq(triviaConfigTable.key, "activeEvent"));
  return cfg?.value ?? null;
}

export async function setActiveEvent(eventName: string): Promise<void> {
  await db
    .insert(triviaConfigTable)
    .values({ key: "activeEvent", value: eventName })
    .onConflictDoUpdate({ target: triviaConfigTable.key, set: { value: eventName } });
}

export async function clearActiveEvent(): Promise<void> {
  await db
    .insert(triviaConfigTable)
    .values({ key: "activeEvent", value: null })
    .onConflictDoUpdate({ target: triviaConfigTable.key, set: { value: null } });
}

export async function getActiveTeam(): Promise<string | null> {
  const [cfg] = await db
    .select()
    .from(triviaConfigTable)
    .where(eq(triviaConfigTable.key, "activeTeam"));
  return cfg?.value ?? null;
}

export async function setActiveTeam(teamName: string): Promise<void> {
  await db
    .insert(triviaConfigTable)
    .values({ key: "activeTeam", value: teamName })
    .onConflictDoUpdate({ target: triviaConfigTable.key, set: { value: teamName } });
}

export async function clearActiveTeam(): Promise<void> {
  await db
    .insert(triviaConfigTable)
    .values({ key: "activeTeam", value: null })
    .onConflictDoUpdate({ target: triviaConfigTable.key, set: { value: null } });
}

export async function getActiveCategory(): Promise<string | null> {
  const [cfg] = await db
    .select()
    .from(triviaConfigTable)
    .where(eq(triviaConfigTable.key, "activeCategory"));
  return cfg?.value ?? null;
}

export async function setActiveCategory(categoryId: string): Promise<void> {
  await db
    .insert(triviaConfigTable)
    .values({ key: "activeCategory", value: categoryId })
    .onConflictDoUpdate({ target: triviaConfigTable.key, set: { value: categoryId } });
}

export async function clearActiveCategory(): Promise<void> {
  await db
    .insert(triviaConfigTable)
    .values({ key: "activeCategory", value: null })
    .onConflictDoUpdate({ target: triviaConfigTable.key, set: { value: null } });
}

export async function getAutoPostEnabled(): Promise<boolean> {
  const [cfg] = await db
    .select()
    .from(triviaConfigTable)
    .where(eq(triviaConfigTable.key, "autoPostEnabled"));
  return cfg?.value !== "false";
}

export async function setAutoPostEnabled(enabled: boolean): Promise<void> {
  await db
    .insert(triviaConfigTable)
    .values({ key: "autoPostEnabled", value: String(enabled) })
    .onConflictDoUpdate({ target: triviaConfigTable.key, set: { value: String(enabled) } });
}

export async function applySeasonEndBonuses(): Promise<
  { discordId: string; username: string; longestStreak: number; bonus: number; finalPoints: number; rank: number }[]
> {
  const BONUSES = [50, 30, 10];
  const top = await db
    .select()
    .from(triviaUsersTable)
    .orderBy(desc(triviaUsersTable.longestStreak))
    .limit(3);

  const results = [];
  for (let i = 0; i < top.length; i++) {
    const user = top[i];
    const bonus = BONUSES[i] ?? 0;
    const finalPoints = user.totalPoints + bonus;
    await db
      .update(triviaUsersTable)
      .set({ totalPoints: finalPoints })
      .where(eq(triviaUsersTable.discordId, user.discordId));
    results.push({
      discordId: user.discordId,
      username: user.username,
      longestStreak: user.longestStreak,
      bonus,
      finalPoints,
      rank: i + 1,
    });
  }
  return results;
}
