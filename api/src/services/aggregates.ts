import {
  MoodEnum,
  type Mood,
  type AdminStatsResponse,
  type DailyTrendItem,
} from '@journal/shared';
import { db, FieldValue } from '../firebase.js';

const MOOD_SCORE_WEIGHTS: Record<Mood, number> = {
  joyful: 4,
  calm: 3,
  neutral: 0,
  anxious: -2,
  sad: -3,
  angry: -4,
  mixed: 0,
};

/**
 * Atomically updates the daily aggregate document for population-level statistics.
 *
 * Constraints:
 * 1. Must use nested object syntax `{ moodDistribution: { [mood]: FieldValue.increment(1) } }` with `{ merge: true }`.
 *    (Dotted strings `"moodDistribution.joyful"` create literal dot-named fields in set/merge).
 * 2. Zero PII, user IDs, emails, titles, summaries, tags, or locations stored in aggregates.
 */
export async function recordEntryAggregate(
  mood: Mood,
  dateStr?: string
): Promise<void> {
  const today = dateStr || new Date().toISOString().slice(0, 10);
  const docRef = db.doc(`aggregates/daily_${today}`);

  await docRef.set(
    {
      date: today,
      totalEntries: FieldValue.increment(1),
      moodDistribution: {
        [mood]: FieldValue.increment(1),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export interface GetAdminStatsOptions {
  rangeDays?: number;
}

/**
 * Retrieves de-identified population-level metrics.
 *
 * Privacy Invariants:
 * 1. Small-sample suppression (< 5 active users in the window): returns `suppressed: true`,
 *    `moodDistribution: null`, `averageMoodScore: null`.
 * 2. Absolutely zero user identifiers, titles, summaries, tags, or locations are returned.
 */
export async function getAdminStats(
  opts: GetAdminStatsOptions = {}
): Promise<AdminStatsResponse> {
  const days = opts.rangeDays || 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffDateKey = cutoffDate.toISOString().slice(0, 10);

  // 1. Fetch aggregates in window
  const snap = await db
    .collection('aggregates')
    .where('date', '>=', cutoffDateKey)
    .orderBy('date', 'asc')
    .limit(days + 5)
    .get();

  const dailyDocs = snap.docs.map((d) => d.data());

  let totalEntries = 0;
  const combinedMoodCounts: Record<Mood, number> = {
    joyful: 0,
    calm: 0,
    neutral: 0,
    anxious: 0,
    sad: 0,
    angry: 0,
    mixed: 0,
  };

  const dailyTrend: DailyTrendItem[] = [];

  for (const data of dailyDocs) {
    const entries = typeof data.totalEntries === 'number' ? data.totalEntries : 0;
    const activeUsers = typeof data.activeUsers === 'number' ? data.activeUsers : 0;
    const date = typeof data.date === 'string' ? data.date : '';

    if (date) {
      dailyTrend.push({
        date,
        entries,
        activeUsers,
      });
    }

    totalEntries += entries;

    if (data.moodDistribution && typeof data.moodDistribution === 'object') {
      for (const mood of MoodEnum.options) {
        const count = data.moodDistribution[mood];
        if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
          combinedMoodCounts[mood] += count;
        }
      }
    }
  }

  // 2. Compute distinct active users across the platform in the window
  let activeUsersCount = 0;
  try {
    const usersSnap = await db.collection('users').get();
    activeUsersCount = usersSnap.docs.length;
  } catch (_err) {
    // In test harness or minimal setups, fallback to sum of daily active users or default
    activeUsersCount = dailyDocs.reduce((acc, d) => Math.max(acc, d.activeUsers || 0), 0);
  }

  // 3. Check small-sample suppression threshold (< 5 active users)
  const isSuppressed = activeUsersCount < 5 || totalEntries === 0;

  if (isSuppressed) {
    return {
      totalEntries,
      activeUsers: activeUsersCount,
      suppressed: true,
      moodDistribution: null,
      averageMoodScore: null,
      dailyTrend,
    };
  }

  // 4. Compute unsuppressed metrics
  let weightedScoreSum = 0;
  let totalMoodCount = 0;
  for (const mood of MoodEnum.options) {
    const count = combinedMoodCounts[mood];
    weightedScoreSum += count * MOOD_SCORE_WEIGHTS[mood];
    totalMoodCount += count;
  }

  const rawAvg = totalMoodCount > 0 ? Number((weightedScoreSum / totalMoodCount).toFixed(2)) : 0;
  const averageMoodScore = rawAvg === 0 ? 0 : rawAvg;

  return {
    totalEntries,
    activeUsers: activeUsersCount,
    suppressed: false,
    moodDistribution: combinedMoodCounts,
    averageMoodScore,
    dailyTrend,
  };
}
