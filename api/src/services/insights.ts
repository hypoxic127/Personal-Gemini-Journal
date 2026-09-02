import { Timestamp } from 'firebase-admin/firestore';
import {
  MoodEnum,
  type InsightRange,
  type Mood,
  type MoodInsightResponse,
  type MoodTimelinePoint,
  type MoodDistributionItem,
  type TagFrequency,
  type MoodHighlightEntry,
} from '@journal/shared';
import { db } from '../firebase.js';

const entriesCol = (uid: string) => db.collection(`users/${uid}/entries`);

const toIso = (value: unknown): string =>
  value instanceof Timestamp ? value.toDate().toISOString() : new Date().toISOString();

const RANGE_DAYS: Record<InsightRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export async function getMoodInsights(
  uid: string,
  range: InsightRange = '30d'
): Promise<MoodInsightResponse> {
  const days = RANGE_DAYS[range] || 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  cutoffDate.setHours(0, 0, 0, 0);

  const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

  // Bounded query under caller's isolated subtree
  const snap = await entriesCol(uid)
    .where('createdAt', '>=', cutoffTimestamp)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const entries: Array<{
    id: string;
    title: string;
    summary: string;
    mood: Mood;
    moodScore: number;
    moodReason: string;
    tags: string[];
    createdAt: string;
    dateKey: string;
  }> = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const createdAtIso = toIso(data.createdAt);
    const dateKey = createdAtIso.slice(0, 10); // YYYY-MM-DD
    const moodParsed = MoodEnum.safeParse(data.mood);
    const mood: Mood = moodParsed.success ? moodParsed.data : 'neutral';
    const moodScore = typeof data.moodScore === 'number' && Number.isFinite(data.moodScore) ? data.moodScore : 0;
    const moodReason = typeof data.moodReason === 'string' ? data.moodReason : '';
    const title = typeof data.title === 'string' ? data.title : 'Reflection';
    const summary = typeof data.summary === 'string' ? data.summary : '';
    const tags = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : [];

    entries.push({
      id: doc.id,
      title,
      summary,
      mood,
      moodScore,
      moodReason,
      tags,
      createdAt: createdAtIso,
      dateKey,
    });
  }

  const totalEntries = entries.length;

  // 1. Average mood score
  const totalScore = entries.reduce((acc, e) => acc + e.moodScore, 0);
  const averageMoodScore = totalEntries > 0 ? Number((totalScore / totalEntries).toFixed(2)) : 0;

  // 2. Timeline aggregation (group by dateKey)
  const dailyMap = new Map<string, {
    scores: number[];
    moodCounts: Map<Mood, number>;
    reasons: string[];
  }>();

  for (const e of entries) {
    if (!dailyMap.has(e.dateKey)) {
      dailyMap.set(e.dateKey, { scores: [], moodCounts: new Map(), reasons: [] });
    }
    const day = dailyMap.get(e.dateKey)!;
    day.scores.push(e.moodScore);
    day.moodCounts.set(e.mood, (day.moodCounts.get(e.mood) || 0) + 1);
    if (e.moodReason && !day.reasons.includes(e.moodReason) && day.reasons.length < 3) {
      day.reasons.push(e.moodReason);
    }
  }

  const timeline: MoodTimelinePoint[] = Array.from(dailyMap.entries())
    .map(([date, data]) => {
      const avg = Number((data.scores.reduce((a, b) => a + b, 0) / data.scores.length).toFixed(2));
      let dominantMood: Mood = 'neutral';
      let maxCount = -1;
      for (const [m, count] of data.moodCounts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          dominantMood = m;
        }
      }
      return {
        date,
        averageScore: avg,
        entryCount: data.scores.length,
        dominantMood,
        reasons: data.reasons,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date)); // Chronological ascending for charts

  // 3. Mood distribution
  const allMoodCounts: Record<Mood, number> = {
    joyful: 0,
    calm: 0,
    neutral: 0,
    anxious: 0,
    sad: 0,
    angry: 0,
    mixed: 0,
  };

  for (const e of entries) {
    allMoodCounts[e.mood] = (allMoodCounts[e.mood] || 0) + 1;
  }

  const distribution: MoodDistributionItem[] = MoodEnum.options.map((m) => {
    const count = allMoodCounts[m] || 0;
    const percentage = totalEntries > 0 ? Number(((count / totalEntries) * 100).toFixed(1)) : 0;
    return {
      mood: m,
      count,
      percentage,
    };
  });

  // 4. Top Tags aggregation
  const tagCounts = new Map<string, number>();
  for (const e of entries) {
    for (const tag of e.tags) {
      if (tag) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
  }

  const topTags: TagFrequency[] = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // 5. Highlights for Explainability (most recent 5 entries)
  const highlights: MoodHighlightEntry[] = entries.slice(0, 5).map((e) => ({
    id: e.id,
    title: e.title,
    mood: e.mood,
    moodScore: e.moodScore,
    moodReason: e.moodReason,
    createdAt: e.createdAt,
    tags: e.tags,
  }));

  return {
    range,
    totalEntries,
    averageMoodScore,
    timeline,
    distribution,
    topTags,
    highlights,
  };
}