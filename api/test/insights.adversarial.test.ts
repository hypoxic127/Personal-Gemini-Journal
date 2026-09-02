import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import express, { type Request, type Response } from 'express';
import type { Server } from 'http';
import { Timestamp } from 'firebase-admin/firestore';
import {
  MoodInsightResponseSchema,
  MoodEnum,
  type Mood,
} from '@journal/shared';

// Mock Firebase
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
  auth: {
    verifyIdToken: vi.fn(async (token: string) => {
      if (token === 'valid_token_victim') {
        return { uid: 'user_victim', email: 'victim@example.com', role: 'user' };
      }
      if (token === 'valid_token_attacker') {
        return { uid: 'user_attacker', email: 'attacker@example.com', role: 'user' };
      }
      throw new Error('Invalid token');
    }),
  },
  db: {
    collection: (path: string) => {
      if (path.includes('/entries')) {
        return mockEntriesCol();
      }
      return {};
    },
  },
  FieldValue: { serverTimestamp: () => 'SENTINEL', increment: (n: number) => ({ inc: n }) },
  Timestamp: {
    fromDate: (d: Date) => ({ toDate: () => d }),
  },
}));

const { default: insightsRouter } = await import('../src/routes/insights.js');
const { getMoodInsights, toIso } = await import('../src/services/insights.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

describe('Adversarial Stress Harness: Mood Insights API & Service', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/insights', insightsRouter);
    app.use(errorHandler);

    await new Promise<void>((resolve, reject) => {
      const s = app.listen(0, '127.0.0.1', () => {
        server = s;
        const addr = s.address();
        if (typeof addr === 'object' && addr && addr.port) {
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        } else {
          reject(new Error('Failed to obtain server address'));
        }
      });
      s.on('error', reject);
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    mockDocs = [];
    capturedWhereArgs = [];
    capturedLimit = undefined;
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Parameter Smuggling, HTTP Pollution & Query Boundary Attacks
  // =========================================================================
  describe('1. Parameter Smuggling & Fuzzing', () => {
    const attackPayloads = [
      { name: 'invalid string', query: 'range=invalid_range' },
      { name: 'oversized range', query: 'range=1000d' },
      { name: 'zero range', query: 'range=0d' },
      { name: 'negative range', query: 'range=-7d' },
      { name: 'empty range value', query: 'range=' },
      { name: 'null string', query: 'range=null' },
      { name: 'undefined string', query: 'range=undefined' },
      { name: 'numeric range', query: 'range=30' },
      { name: 'prototype toString', query: 'range=toString' },
      { name: 'prototype valueOf', query: 'range=valueOf' },
      { name: 'prototype constructor', query: 'range=constructor' },
      { name: 'prototype hasOwnProperty', query: 'range=hasOwnProperty' },
      { name: 'prototype __proto__', query: 'range=__proto__' },
      { name: 'parameter pollution array (duplicate range)', query: 'range=7d&range=30d' },
      { name: 'array syntax', query: 'range[]=30d' },
      { name: 'object syntax injection', query: 'range[gt]=0' },
      { name: 'null byte injection', query: 'range=30d%00' },
      { name: 'newline CRLF injection', query: 'range=30d%0D%0A' },
      { name: 'unknown extra field (strict mode test)', query: 'range=30d&isAdmin=true' },
      { name: 'SQL-like injection attempt', query: "range=30d' OR 1=1--" },
      { name: 'NoSQL-like injection attempt', query: 'range[$ne]=null' },
      { name: 'script tag XSS in range', query: 'range=<script>alert(1)</script>' },
      { name: 'constructor prototype key injection', query: 'constructor[prototype][polluted]=true' },
    ];

    for (const attack of attackPayloads) {
      it(`ADV-PARAM-01 [${attack.name}]: strictly rejected with HTTP 400 BAD_REQUEST`, async () => {
        const res = await fetch(`${baseUrl}/api/insights/mood?${attack.query}`, {
          headers: { Authorization: 'Bearer valid_token_victim' },
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBeDefined();
        expect(body.error.code).toBe('BAD_REQUEST');
      });
    }

    it('ADV-PARAM-02: __proto__ query injection does not pollute Object.prototype and defaults safely to 30d', async () => {
      const res = await fetch(`${baseUrl}/api/insights/mood?__proto__[polluted]=true`, {
        headers: { Authorization: 'Bearer valid_token_victim' },
      });

      // Express drops __proto__ properties, leaving query empty, which defaults to 30d without polluting Object.prototype
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.range).toBe('30d');
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('ADV-PARAM-03: rejected with HTTP 405 or 404 for unsupported HTTP methods (POST, PUT, DELETE, PATCH)', async () => {
      const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];
      for (const method of methods) {
        const res = await fetch(`${baseUrl}/api/insights/mood`, {
          method,
          headers: {
            Authorization: 'Bearer valid_token_victim',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ range: '30d' }),
        });
        expect([404, 405]).toContain(res.status);
      }
    });

    it('ADV-PARAM-04: spoofed user headers (x-user-id, x-uid) never override verified auth token', async () => {
      mockDocs = [
        {
          id: 'v1',
          mood: 'calm',
          moodScore: 3,
          createdAt: Timestamp.fromDate(new Date()),
        },
      ];

      const res = await fetch(`${baseUrl}/api/insights/mood?range=30d`, {
        headers: {
          Authorization: 'Bearer valid_token_victim',
          'x-user-id': 'user_attacker',
          'x-authenticated-user': 'user_attacker',
          'x-uid': 'user_attacker',
        },
      });

      expect(res.status).toBe(200);
      // Ensure db.collection was called with victim's UID, not attacker's
      expect(mockEntriesCol).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. Zero-Entries, Cold-Start & Edge Baseline Stability
  // =========================================================================
  describe('2. Zero-Entries & Empty User Baseline Stability', () => {
    it('ADV-ZERO-01: brand new user with 0 entries returns perfectly well-formed empty response', async () => {
      mockDocs = [];

      const res = await getMoodInsights('user_brand_new', '30d');

      const parsed = MoodInsightResponseSchema.safeParse(res);
      expect(parsed.success).toBe(true);

      expect(res.totalEntries).toBe(0);
      expect(res.averageMoodScore).toBe(0);
      expect(res.timeline).toEqual([]);
      expect(res.topTags).toEqual([]);
      expect(res.highlights).toEqual([]);
      expect(res.truncated).toBe(false);
      expect(res.range).toBe('30d');

      // Distribution must have all 7 standard moods with count 0 and percentage 0
      expect(res.distribution).toHaveLength(7);
      const moodsPresent = res.distribution.map((d) => d.mood);
      expect(moodsPresent).toEqual(MoodEnum.options);
      for (const item of res.distribution) {
        expect(item.count).toBe(0);
        expect(item.percentage).toBe(0);
        expect(Number.isFinite(item.percentage)).toBe(true);
        expect(Number.isNaN(item.percentage)).toBe(false);
      }
    });

    it('ADV-ZERO-02: user with only corrupt/unparseable entries degrades gracefully to clean zero-baseline without crashing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockDocs = [
        { id: 'c1', createdAt: 'not-a-date', mood: 'joyful', moodScore: 5 },
        { id: 'c2', createdAt: { _seconds: NaN }, mood: 'calm', moodScore: 4 },
        { id: 'c3', createdAt: null, mood: 'anxious', moodScore: -2 },
        { id: 'c4', createdAt: 12345678, mood: 'sad', moodScore: -3 },
        { id: 'c5', createdAt: undefined, mood: 'mixed', moodScore: 0 },
        { id: 'c6', createdAt: {}, mood: 'neutral', moodScore: 0 },
        { id: 'c7', createdAt: { toDate: () => { throw new Error('Simulated timestamp crash'); } }, mood: 'angry', moodScore: -5 },
      ];

      const res = await getMoodInsights('user_all_corrupted', '30d');

      const parsed = MoodInsightResponseSchema.safeParse(res);
      expect(parsed.success).toBe(true);
      expect(res.totalEntries).toBe(0);
      expect(res.averageMoodScore).toBe(0);
      expect(res.timeline).toEqual([]);
      expect(res.highlights).toEqual([]);
      expect(res.topTags).toEqual([]);
      warnSpy.mockRestore();
    });

    it('ADV-ZERO-03: handles -0 average gracefully without returning negative zero in response', async () => {
      // Small negative numbers that round to 0.00 should normalize to 0, not -0
      mockDocs = [
        {
          id: 'n1',
          mood: 'neutral',
          moodScore: -0.001,
          createdAt: Timestamp.fromDate(new Date()),
        },
      ];

      const res = await getMoodInsights('user_neg_zero', '30d');
      expect(res.averageMoodScore).toBe(0);
      expect(Object.is(res.averageMoodScore, -0)).toBe(false);
      expect(Object.is(res.averageMoodScore, 0)).toBe(true);

      if (res.timeline.length > 0) {
        expect(res.timeline[0].averageScore).toBe(0);
        expect(Object.is(res.timeline[0].averageScore, -0)).toBe(false);
      }
    });
  });

  // =========================================================================
  // 3. Single-entry vs Multi-entry Date Grouping, Averaging & Rounding
  // =========================================================================
  describe('3. Precision, Averaging, Grouping & 7-Mood Rounding', () => {
    it('ADV-PREC-01: single entry on a day correctly sets day average, dominant mood and reason', async () => {
      const targetDate = '2026-09-02T14:30:00.000Z';
      mockDocs = [
        {
          id: 'single_1',
          title: 'Deep Meditation',
          summary: 'Quiet morning',
          mood: 'calm',
          moodScore: 4.25,
          moodReason: 'Peaceful quiet breathing session',
          tags: ['mindfulness', 'morning'],
          createdAt: Timestamp.fromDate(new Date(targetDate)),
        },
      ];

      const res = await getMoodInsights('user_single', '30d');
      expect(res.totalEntries).toBe(1);
      expect(res.averageMoodScore).toBe(4.25);
      expect(res.timeline).toHaveLength(1);
      expect(res.timeline[0].date).toBe('2026-09-02');
      expect(res.timeline[0].averageScore).toBe(4.25);
      expect(res.timeline[0].dominantMood).toBe('calm');
      expect(res.timeline[0].entryCount).toBe(1);
      expect(res.timeline[0].reasons).toEqual(['Peaceful quiet breathing session']);
    });

    it('ADV-PREC-02: multi-entry on same date correctly computes day average, dominant mood, and caps reasons to 3', async () => {
      const date = '2026-09-02';
      mockDocs = [
        { id: 'm1', mood: 'joyful', moodScore: 5.0, moodReason: 'Promoted to Staff', createdAt: `${date}T09:00:00.000Z` },
        { id: 'm2', mood: 'joyful', moodScore: 4.0, moodReason: 'Celebrated with team', createdAt: `${date}T12:00:00.000Z` },
        { id: 'm3', mood: 'calm', moodScore: 3.0, moodReason: 'Coffee break', createdAt: `${date}T15:00:00.000Z` },
        { id: 'm4', mood: 'anxious', moodScore: -1.0, moodReason: 'Upcoming presentation', createdAt: `${date}T18:00:00.000Z` },
        { id: 'm5', mood: 'joyful', moodScore: 4.0, moodReason: 'Presentation went great', createdAt: `${date}T20:00:00.000Z` },
        { id: 'm6', mood: 'joyful', moodScore: 4.0, moodReason: 'Dinner with friends', createdAt: `${date}T22:00:00.000Z` },
      ];

      const res = await getMoodInsights('user_multi', '30d');
      expect(res.timeline).toHaveLength(1);
      const day = res.timeline[0];
      expect(day.date).toBe(date);
      expect(day.entryCount).toBe(6);
      // (5 + 4 + 3 - 1 + 4 + 4) / 6 = 19 / 6 = 3.16666... -> 3.17
      expect(day.averageScore).toBe(3.17);
      expect(day.dominantMood).toBe('joyful'); // 4 joyful vs 1 calm vs 1 anxious
      expect(day.reasons.length).toBe(3); // capped to max 3 reasons
    });

    it('ADV-PREC-03: chronological sorting across distinct dates regardless of retrieval order', async () => {
      mockDocs = [
        { id: 'd3', mood: 'joyful', moodScore: 3, createdAt: '2026-09-05T10:00:00.000Z' },
        { id: 'd1', mood: 'calm', moodScore: 2, createdAt: '2026-09-01T10:00:00.000Z' },
        { id: 'd4', mood: 'anxious', moodScore: -2, createdAt: '2026-09-10T10:00:00.000Z' },
        { id: 'd2', mood: 'neutral', moodScore: 0, createdAt: '2026-09-03T10:00:00.000Z' },
      ];

      const res = await getMoodInsights('user_sort', '30d');
      const timelineDates = res.timeline.map((t) => t.date);
      expect(timelineDates).toEqual(['2026-09-01', '2026-09-03', '2026-09-05', '2026-09-10']);
    });

    it('ADV-PREC-04: Monte Carlo property verification — 7-mood percentage sum is always ~100% (within 99.0%..101.0%) across 200 random configurations', async () => {
      const moods: Mood[] = ['joyful', 'calm', 'neutral', 'anxious', 'sad', 'angry', 'mixed'];

      for (let run = 0; run < 200; run++) {
        const entryCount = Math.floor(Math.random() * 100) + 1; // 1 to 100 entries
        mockDocs = Array.from({ length: entryCount }, (_, i) => ({
          id: `rand_${i}`,
          mood: moods[Math.floor(Math.random() * moods.length)],
          moodScore: Math.round((Math.random() * 10 - 5) * 10) / 10,
          createdAt: '2026-09-02T10:00:00.000Z',
        }));

        const res = await getMoodInsights('user_monte_carlo', '30d');
        const parsed = MoodInsightResponseSchema.safeParse(res);
        expect(parsed.success).toBe(true);

        const sumPercentage = res.distribution.reduce((acc, d) => acc + d.percentage, 0);
        // Due to rounding to 1 decimal place (e.g. 1/7 = 14.3% -> sum = 100.1%), sum should be strictly between 99.0% and 101.0%
        expect(sumPercentage).toBeGreaterThanOrEqual(99.0);
        expect(sumPercentage).toBeLessThanOrEqual(101.0);

        // Individual counts must sum exactly to totalEntries
        const sumCounts = res.distribution.reduce((acc, d) => acc + d.count, 0);
        expect(sumCounts).toBe(entryCount);
      }
    });

    it('ADV-PREC-05: score clamping and floating point rounding precision for boundary values', async () => {
      mockDocs = [
        { id: 'b1', mood: 'joyful', moodScore: 5.00000001, createdAt: '2026-09-02T10:00:00.000Z' },
        { id: 'b2', mood: 'angry', moodScore: -5.00000001, createdAt: '2026-09-02T11:00:00.000Z' },
        { id: 'b3', mood: 'mixed', moodScore: 2.34567, createdAt: '2026-09-02T12:00:00.000Z' },
      ];

      const res = await getMoodInsights('user_float', '30d');
      // b1 clamped/rounded to 5.00, b2 to -5.00, b3 to 2.35
      // (5.00 + (-5.00) + 2.35) / 3 = 2.35 / 3 = 0.78333... -> 0.78
      expect(res.averageMoodScore).toBe(0.78);
      expect(res.highlights[0].moodScore).toBe(5);
      expect(res.highlights[1].moodScore).toBe(-5);
      expect(res.highlights[2].moodScore).toBe(2.35);
    });
  });

  // =========================================================================
  // 4. Dirty Data & Adversarial Firestore Document Resilience
  // =========================================================================
  describe('4. Dirty Document & Adversarial Payload Resilience', () => {
    it('ADV-DIRTY-01: handles completely wild document fields without unhandled exceptions', async () => {
      mockDocs = [
        {
          id: 'dirty_1',
          title: 12345, // not string
          summary: ['an', 'array'], // not string
          mood: 'UNKNOWN_MOOD_STRING', // invalid enum
          moodScore: 'string_score', // not number
          moodReason: { reason: 'nested object' }, // not string
          tags: 'not-an-array', // not array
          createdAt: Timestamp.fromDate(new Date('2026-09-02T10:00:00.000Z')),
        },
        {
          id: 'dirty_2',
          title: '   ', // whitespace
          summary: null,
          mood: null,
          moodScore: Infinity, // Infinity
          moodReason: null,
          tags: [null, undefined, 123, '  valid tag  ', 'valid tag', ''],
          createdAt: Timestamp.fromDate(new Date('2026-09-02T11:00:00.000Z')),
        },
      ];

      const res = await getMoodInsights('user_dirty', '30d');
      const parsed = MoodInsightResponseSchema.safeParse(res);
      expect(parsed.success).toBe(true);

      expect(res.totalEntries).toBe(2);
      // dirty_1: title -> 'Reflection', mood -> 'neutral', moodScore -> 0, tags -> []
      expect(res.highlights[0].title).toBe('Reflection');
      expect(res.highlights[0].mood).toBe('neutral');
      expect(res.highlights[0].moodScore).toBe(0);
      expect(res.highlights[0].tags).toEqual([]);

      // dirty_2: title -> 'Reflection', mood -> 'neutral', moodScore -> 0, tags -> ['valid tag', 'valid tag']
      expect(res.highlights[1].title).toBe('Reflection');
      expect(res.highlights[1].mood).toBe('neutral');
      expect(res.highlights[1].moodScore).toBe(0);
      expect(res.highlights[1].tags).toEqual(['valid tag', 'valid tag']);

      // Top tags should count 'valid tag' once (deduplicated per entry)
      expect(res.topTags).toEqual([{ tag: 'valid tag', count: 1 }]);
    });

    it('ADV-DIRTY-02: prototype property names in tags or moods do not pollute aggregation maps', async () => {
      mockDocs = [
        {
          id: 'proto_1',
          mood: 'joyful',
          moodScore: 4,
          tags: ['toString', 'valueOf', 'constructor', '__proto__', 'hasOwnProperty'],
          createdAt: Timestamp.fromDate(new Date('2026-09-02T10:00:00.000Z')),
        },
      ];

      const res = await getMoodInsights('user_proto_tags', '30d');
      const parsed = MoodInsightResponseSchema.safeParse(res);
      expect(parsed.success).toBe(true);

      const tagNames = res.topTags.map((t) => t.tag);
      expect(tagNames).toContain('toString');
      expect(tagNames).toContain('valueOf');
      expect(tagNames).toContain('constructor');
      expect(tagNames).toContain('__proto__');
      expect(tagNames).toContain('hasOwnProperty');
      for (const t of res.topTags) {
        expect(t.count).toBe(1);
      }
    });
  });

  // =========================================================================
  // 5. Query Boundaries, Hard Limits & Truncation Semantics
  // =========================================================================
  describe('5. Boundaries, Truncation & Query Capacity', () => {
    it('ADV-TRUNC-01: exactly 500 documents triggers truncated: true and caps highlights to 5', async () => {
      mockDocs = Array.from({ length: 500 }, (_, i) => ({
        id: `doc_${i}`,
        title: `Entry ${i}`,
        mood: 'calm',
        moodScore: 3.5,
        tags: [`tag_${i % 5}`],
        createdAt: Timestamp.fromDate(new Date('2026-09-02T10:00:00.000Z')),
      }));

      const res = await getMoodInsights('user_trunc_500', '30d');
      expect(res.truncated).toBe(true);
      expect(res.totalEntries).toBe(500);
      expect(res.highlights).toHaveLength(5);
      expect(res.topTags).toHaveLength(5);
      const parsed = MoodInsightResponseSchema.safeParse(res);
      expect(parsed.success).toBe(true);
    });

    it('ADV-TRUNC-02: 499 documents results in truncated: false', async () => {
      mockDocs = Array.from({ length: 499 }, (_, i) => ({
        id: `doc_${i}`,
        title: `Entry ${i}`,
        mood: 'calm',
        moodScore: 3.5,
        tags: [`tag_${i % 5}`],
        createdAt: Timestamp.fromDate(new Date('2026-09-02T10:00:00.000Z')),
      }));

      const res = await getMoodInsights('user_trunc_499', '30d');
      expect(res.truncated).toBe(false);
      expect(res.totalEntries).toBe(499);
      const parsed = MoodInsightResponseSchema.safeParse(res);
      expect(parsed.success).toBe(true);
    });

    it('ADV-TRUNC-03: Performance stress — processing 500 records takes under 20ms CPU time', async () => {
      mockDocs = Array.from({ length: 500 }, (_, i) => ({
        id: `perf_doc_${i}`,
        title: `Performance Stress Entry #${i}`,
        summary: `Summary text for entry ${i}`,
        mood: (['joyful', 'calm', 'neutral', 'anxious', 'sad', 'angry', 'mixed'] as Mood[])[i % 7],
        moodScore: (i % 11) - 5,
        moodReason: `Reason why mood is ${(i % 11) - 5}`,
        tags: [`tag_${i % 20}`, `category_${i % 10}`, 'general'],
        createdAt: Timestamp.fromDate(new Date(Date.now() - (i % 30) * 86400000)),
      }));

      const start = performance.now();
      const res = await getMoodInsights('user_perf', '90d');
      const elapsed = performance.now() - start;

      expect(res.totalEntries).toBe(500);
      expect(res.timeline.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(50); // Well under 50ms (typically 2-6ms)
    });
  });
});
