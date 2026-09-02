import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { MoodInsightResponseSchema } from '@journal/shared';

// Create a mock collection with query chaining
let mockDocs: any[] = [];
let capturedWhereArgs: any[] = [];
let capturedLimit: number | undefined;

const mockQuery = {
  where: vi.fn((field, op, val) => {
    capturedWhereArgs.push({ field, op, val });
    return mockQuery;
  }),
  orderBy: vi.fn(() => mockQuery),
  limit: vi.fn((lim) => {
    capturedLimit = lim;
    return mockQuery;
  }),
  get: vi.fn(async () => ({
    docs: mockDocs.map((d, index) => ({
      id: d.id || `doc_${index}`,
      data: () => d,
    })),
    size: mockDocs.length,
  })),
};

const mockEntriesCol = vi.fn(() => mockQuery);

vi.mock('../src/firebase.js', () => ({
  db: {
    collection: (path: string) => {
      if (path.includes('/entries')) {
        return mockEntriesCol();
      }
      return {};
    },
  },
}));

const { getMoodInsights, toIso } = await import('../src/services/insights.js');

describe('Insights Service Unit Tests (getMoodInsights)', () => {
  beforeEach(() => {
    mockDocs = [];
    capturedWhereArgs = [];
    capturedLimit = undefined;
    vi.clearAllMocks();
  });

  it('POS-INSIGHT-SVC-01: calculates daily averages, dominant mood, tag frequencies, and highlights', async () => {
    mockDocs = [
      {
        id: 'e1',
        title: 'Project Launch',
        summary: 'Launched on time',
        mood: 'joyful',
        moodScore: 4.5,
        moodReason: 'Team effort succeeded',
        tags: ['launch', 'work'],
        createdAt: Timestamp.fromDate(new Date('2026-09-02T10:00:00.000Z')),
      },
      {
        id: 'e2',
        title: 'Minor Bug Fix',
        summary: 'Fixed quick issue',
        mood: 'calm',
        moodScore: 3.5,
        moodReason: 'Resolved easily',
        tags: ['work', 'coding'],
        createdAt: Timestamp.fromDate(new Date('2026-09-02T15:00:00.000Z')),
      },
      {
        id: 'e3',
        title: 'Morning Yoga',
        summary: 'Peaceful morning',
        mood: 'calm',
        moodScore: 4.0,
        moodReason: 'Refreshed body and mind',
        tags: ['health', 'morning'],
        createdAt: Timestamp.fromDate(new Date('2026-09-01T08:00:00.000Z')),
      },
    ];

    const res = await getMoodInsights('user_test_1', '30d');

    // Verify response schema
    const parsed = MoodInsightResponseSchema.safeParse(res);
    expect(parsed.success).toBe(true);

    expect(res.totalEntries).toBe(3);
    // (4.5 + 3.5 + 4.0) / 3 = 12 / 3 = 4.0
    expect(res.averageMoodScore).toBe(4.0);
    expect(res.truncated).toBe(false);

    // Timeline should have 2 days sorted chronologically (2026-09-01, 2026-09-02)
    expect(res.timeline.length).toBe(2);
    expect(res.timeline[0].date).toBe('2026-09-01');
    expect(res.timeline[0].entryCount).toBe(1);
    expect(res.timeline[0].averageScore).toBe(4.0);
    expect(res.timeline[0].dominantMood).toBe('calm');

    expect(res.timeline[1].date).toBe('2026-09-02');
    expect(res.timeline[1].entryCount).toBe(2);
    // (4.5 + 3.5) / 2 = 4.0
    expect(res.timeline[1].averageScore).toBe(4.0);
    // joyful (1), calm (1) -> calm or joyful
    expect(['joyful', 'calm']).toContain(res.timeline[1].dominantMood);
    expect(res.timeline[1].reasons.length).toBe(2);

    // Distribution
    const joyfulDist = res.distribution.find((d) => d.mood === 'joyful');
    const calmDist = res.distribution.find((d) => d.mood === 'calm');
    expect(joyfulDist?.count).toBe(1);
    expect(joyfulDist?.percentage).toBe(33.3);
    expect(calmDist?.count).toBe(2);
    expect(calmDist?.percentage).toBe(66.7);

    // Top tags: 'work' appears in 2 entries, others in 1
    expect(res.topTags[0].tag).toBe('work');
    expect(res.topTags[0].count).toBe(2);

    // Highlights: most recent first
    expect(res.highlights.length).toBe(3);
    expect(res.highlights[0].id).toBe('e1');
    expect(res.highlights[0].moodReason).toBe('Team effort succeeded');
  });

  it('POS-INSIGHT-SVC-02: handles empty/cold-start collection gracefully without NaN or 0 division', async () => {
    mockDocs = [];

    const res = await getMoodInsights('user_empty', '7d');
    const parsed = MoodInsightResponseSchema.safeParse(res);
    expect(parsed.success).toBe(true);

    expect(res.totalEntries).toBe(0);
    expect(res.averageMoodScore).toBe(0);
    expect(res.timeline).toEqual([]);
    expect(res.topTags).toEqual([]);
    expect(res.highlights).toEqual([]);
    expect(res.truncated).toBe(false);
    expect(res.distribution.length).toBe(7);
    for (const item of res.distribution) {
      expect(item.count).toBe(0);
      expect(item.percentage).toBe(0);
    }
  });

  it('POS-INSIGHT-SVC-03: preserves Date, duck-typed Timestamp, and ISO string timestamps, returning null for unparseable timestamps', () => {
    const rawDate = new Date('2026-08-10T12:00:00.000Z');
    const isoString = '2026-08-15T08:30:00.000Z';
    const ts = Timestamp.fromDate(rawDate);
    const duckTs = { toDate: () => new Date('2026-08-12T00:00:00.000Z') };
    const secondsObj = { _seconds: 1723420800 }; // 2026-08-12T00:00:00.000Z (approx)

    expect(toIso(ts)).toBe('2026-08-10T12:00:00.000Z');
    expect(toIso(rawDate)).toBe('2026-08-10T12:00:00.000Z');
    expect(toIso(isoString)).toBe('2026-08-15T08:30:00.000Z');
    expect(toIso(duckTs)).toBe('2026-08-12T00:00:00.000Z');
    expect(toIso(secondsObj)).toContain('Z');

    // Robustness against malformed, NaN, or throwing objects - returns null
    expect(toIso({ _seconds: NaN })).toBeNull();
    expect(toIso({ seconds: Infinity })).toBeNull();
    expect(toIso({ _seconds: 'not-a-number' })).toBeNull();
    expect(toIso({ toDate: () => { throw new Error('boom'); } })).toBeNull();
    expect(toIso({ toDate: () => new Date('invalid') })).toBeNull();
    expect(toIso(new Date('invalid'))).toBeNull();
    expect(toIso('not-a-valid-date-string')).toBeNull();
    expect(toIso('')).toBeNull();
    expect(toIso(12345678)).toBeNull();
    expect(toIso(null)).toBeNull();
    expect(toIso(undefined)).toBeNull();
  });

  it('POS-INSIGHT-SVC-04: clamps out-of-bounds scores to [-5, 5] and handles NaN scores safely', async () => {
    mockDocs = [
      {
        id: 'e1',
        title: 'Extreme high',
        mood: 'joyful',
        moodScore: 100, // out of bounds
        createdAt: '2026-09-02T10:00:00.000Z',
      },
      {
        id: 'e2',
        title: 'Extreme low',
        mood: 'angry',
        moodScore: -999, // out of bounds
        createdAt: '2026-09-02T11:00:00.000Z',
      },
      {
        id: 'e3',
        title: 'NaN score',
        mood: 'neutral',
        moodScore: NaN,
        createdAt: '2026-09-02T12:00:00.000Z',
      },
    ];

    const res = await getMoodInsights('user_bounds', '30d');

    // e1 clamped to 5, e2 clamped to -5, e3 clamped to 0
    // (5 + (-5) + 0) / 3 = 0.0
    expect(res.averageMoodScore).toBe(0);
    expect(res.highlights[0].moodScore).toBe(5);
    expect(res.highlights[1].moodScore).toBe(-5);
    expect(res.highlights[2].moodScore).toBe(0);
  });

  it('POS-INSIGHT-SVC-05: deduplicates repeated tags within a single entry and strips whitespace', async () => {
    mockDocs = [
      {
        id: 'e1',
        title: 'Entry with duplicate and empty tags',
        mood: 'joyful',
        moodScore: 3,
        tags: ['focus', 'focus', '  focus  ', '', '   ', 'productivity'],
        createdAt: '2026-09-02T10:00:00.000Z',
      },
    ];

    const res = await getMoodInsights('user_tags', '30d');
    expect(res.topTags.find((t) => t.tag === 'focus')?.count).toBe(1);
    expect(res.topTags.find((t) => t.tag === 'productivity')?.count).toBe(1);
    expect(res.topTags.find((t) => t.tag === '')).toBeUndefined();
    expect(res.topTags.length).toBe(2);
  });

  it('POS-INSIGHT-SVC-06: applies correct date range cutoff calculation and sets query limit to 500', async () => {
    await getMoodInsights('user_ranges', '90d');

    expect(capturedLimit).toBe(500);
    expect(capturedWhereArgs.length).toBe(1);
    expect(capturedWhereArgs[0].field).toBe('createdAt');
    expect(capturedWhereArgs[0].op).toBe('>=');

    const cutoffDate = (capturedWhereArgs[0].val as Timestamp).toDate();
    const now = new Date();
    const diffDays = Math.round((now.getTime() - cutoffDate.getTime()) / (1000 * 60 * 60 * 24));
    // 90 days cutoff (allow ±1 day for timezone / test execution boundary)
    expect(diffDays).toBeGreaterThanOrEqual(89);
    expect(diffDays).toBeLessThanOrEqual(91);
  });

  it('POS-INSIGHT-SVC-07: restricts highlights to maximum 5 most recent entries', async () => {
    mockDocs = Array.from({ length: 10 }, (_, i) => ({
      id: `entry_${i}`,
      title: `Reflection ${i}`,
      mood: 'neutral',
      moodScore: 1,
      moodReason: `Reason ${i}`,
      tags: ['tag1'],
      createdAt: `2026-09-0${Math.min(9, i + 1)}T10:00:00.000Z`,
    }));

    const res = await getMoodInsights('user_limit', '30d');
    expect(res.totalEntries).toBe(10);
    expect(res.highlights.length).toBe(5);
    expect(res.highlights[0].id).toBe('entry_0');
    expect(res.highlights[4].id).toBe('entry_4');
  });

  it('POS-INSIGHT-SVC-08: normalizes invalid range input to default 30d in response', async () => {
    mockDocs = [];

    const res = await getMoodInsights('user_invalid_range', 'invalid_range_custom' as any);
    expect(res.range).toBe('30d');
    const parsed = MoodInsightResponseSchema.safeParse(res);
    expect(parsed.success).toBe(true);
  });

  it('NEG-INSIGHT-SVC-09: skips entries with corrupted timestamps and logs structured warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDocs = [
      {
        id: 'corrupt_1',
        title: 'Corrupt Date Entry',
        mood: 'joyful',
        moodScore: 5,
        createdAt: 'totally-invalid-date',
      },
      {
        id: 'valid_1',
        title: 'Valid Date Entry',
        mood: 'calm',
        moodScore: 3,
        createdAt: Timestamp.fromDate(new Date('2026-09-02T10:00:00.000Z')),
      },
    ];

    const res = await getMoodInsights('user_corrupt', '30d');
    expect(res.totalEntries).toBe(1);
    expect(res.highlights.length).toBe(1);
    expect(res.highlights[0].id).toBe('valid_1');
    expect(warnSpy).toHaveBeenCalled();
    const loggedCall = warnSpy.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('CORRUPT_ENTRY_TIMESTAMP_SKIPPED')
    );
    expect(loggedCall).toBeDefined();
    expect(loggedCall?.[0]).toContain('corrupt_1');
    expect(loggedCall?.[0]).toContain('user_corrupt');
    warnSpy.mockRestore();
  });

  it('POS-INSIGHT-SVC-10: returns truncated: true when query reaches maximum limit (500)', async () => {
    mockDocs = Array.from({ length: 500 }, (_, i) => ({
      id: `entry_${i}`,
      title: `Reflection ${i}`,
      mood: 'calm',
      moodScore: 3,
      createdAt: Timestamp.fromDate(new Date('2026-09-02T10:00:00.000Z')),
    }));

    const res = await getMoodInsights('user_trunc', '30d');
    expect(res.truncated).toBe(true);
    expect(res.totalEntries).toBe(500);
    const parsed = MoodInsightResponseSchema.safeParse(res);
    expect(parsed.success).toBe(true);
  });

  it('POS-INSIGHT-SVC-11: returns truncated: false when query result count is below maximum limit (499)', async () => {
    mockDocs = Array.from({ length: 499 }, (_, i) => ({
      id: `entry_${i}`,
      title: `Reflection ${i}`,
      mood: 'calm',
      moodScore: 3,
      createdAt: Timestamp.fromDate(new Date('2026-09-02T10:00:00.000Z')),
    }));

    const res = await getMoodInsights('user_not_trunc', '30d');
    expect(res.truncated).toBe(false);
    expect(res.totalEntries).toBe(499);
    const parsed = MoodInsightResponseSchema.safeParse(res);
    expect(parsed.success).toBe(true);
  });

  it('NEG-INSIGHT-SVC-12: safely returns empty dataset when all entries have corrupted timestamps', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDocs = [
      { id: 'bad_1', createdAt: 'invalid-1' },
      { id: 'bad_2', createdAt: { _seconds: NaN } },
      { id: 'bad_3', createdAt: null },
    ];

    const res = await getMoodInsights('user_all_corrupt', '30d');
    expect(res.totalEntries).toBe(0);
    expect(res.averageMoodScore).toBe(0);
    expect(res.timeline).toEqual([]);
    expect(res.highlights).toEqual([]);
    expect(res.topTags).toEqual([]);
    expect(res.truncated).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(3);
    warnSpy.mockRestore();
  });
});

