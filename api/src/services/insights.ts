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

const MAX_INSIGHT_QUERY_LIMIT = 500;

export const toIso = (value: unknown): string | null => {
  try {
    if (value && typeof (value as any).toDate === 'function') {
      try {
        const d = (value as any).toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
      } catch {
        // ignore
      }
    }
    if (value && typeof value === 'object') {
      if (typeof (value as any)._seconds === 'number' && Number.isFinite((value as any)._seconds)) {
        const d = new Date((value as any)._seconds * 1000);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
      if (typeof (value as any).seconds === 'number' && Number.isFinite((value as any).seconds)) {
        const d = new Date((value as any).seconds * 1000);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
    }
    if (value instanceof Date) {
      if (!Number.isNaN(value.getTime())) return value.toISOString();
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        const parsed = Date.parse(trimmed);
        if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
      }
    }
  } catch {
    return null;
  }
  return null;
};

const RANGE_DAYS: Record<InsightRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export async function getMoodInsights(
  uid: string,
  range: InsightRange = '30d'
): Promise<MoodInsightResponse> {
  const normalizedRange: InsightRange = range in RANGE_DAYS ? range : '30d';
  const days = RANGE_DAYS[normalizedRange] || 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  cutoffDate.setHours(0, 0, 0, 0);

  const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

  // Bounded query under caller's isolated subtree with safe 500 capacity for 90d window
  const snap = await entriesCol(uid)
    .where('createdAt', '>=', cutoffTimestamp)
    .orderBy('createdAt', 'desc')
    .limit(MAX_INSIGHT_QUERY_LIMIT)
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
    if (!createdAtIso) {
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          event: 'CORRUPT_ENTRY_TIMESTAMP_SKIPPED',
          docId: doc.id,
          uid,
        })
      );
      continue;
    }
    const dateKey = createdAtIso.slice(0, 10); // YYYY-MM-DD
    const moodParsed = MoodEnum.safeParse(data.mood);
    const mood: Mood = moodParsed.success ? moodParsed.data : 'neutral';
    const rawScore = typeof data.moodScore === 'number' && Number.isFinite(data.moodScore) ? data.moodScore : 0;
    const moodScore = Math.max(-5, Math.min(5, Math.round(rawScore * 100) / 100));
    const moodReason = typeof data.moodReason === 'string' ? data.moodReason.trim() : '';
    const title = typeof data.title === 'string' && data.title.trim().length > 0 ? data.title.trim() : 'Reflection';
    const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
    const tags = Array.isArray(data.tags)
      ? data.tags
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim())
      : [];

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

  // 1. Average mood score (rounded to 2 decimal places)
  const totalScore = entries.reduce((acc, e) => acc + e.moodScore, 0);
  const rawAvg = totalEntries > 0 ? Number((totalScore / totalEntries).toFixed(2)) : 0;
  const averageMoodScore = rawAvg === 0 ? 0 : rawAvg;

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
      const dayRawAvg = data.scores.length > 0
        ? Number((data.scores.reduce((a, b) => a + b, 0) / data.scores.length).toFixed(2))
        : 0;
      const avg = dayRawAvg === 0 ? 0 : dayRawAvg;
      let dominantMood: Mood = 'neutral';
      let maxCount = 0;
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

  // 4. Top Tags aggregation (deduplicated per entry to prevent artificial skew)
  const tagCounts = new Map<string, number>();
  for (const e of entries) {
    const uniqueTagsInEntry = new Set(e.tags);
    for (const tag of uniqueTagsInEntry) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const topTags: TagFrequency[] = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
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
    range: normalizedRange,
    totalEntries,
    averageMoodScore,
    timeline,
    distribution,
    topTags,
    highlights,
    truncated: (snap.size ?? snap.docs.length) >= MAX_INSIGHT_QUERY_LIMIT,
  };
}