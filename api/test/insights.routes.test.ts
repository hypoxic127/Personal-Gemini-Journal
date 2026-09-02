import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { MoodInsightResponseSchema } from '@journal/shared';

// Mock Firebase token verification
vi.mock('../src/firebase.js', () => ({
  auth: {
    verifyIdToken: vi.fn(async (token: string) => {
      if (token === 'token_user_alice') {
        return { uid: 'user_alice', email: 'alice@example.com', role: 'user' };
      }
      throw new Error('Invalid token');
    }),
  },
  db: {},
  FieldValue: { serverTimestamp: () => 'SENTINEL', increment: (n: number) => ({ inc: n }) },
  Timestamp: {
    fromDate: (d: Date) => ({ toDate: () => d }),
  },
}));

// Mock insights service
const mockInsightsService = {
  getMoodInsights: vi.fn(),
};
vi.mock('../src/services/insights.js', () => mockInsightsService);

const { default: insightsRouter } = await import('../src/routes/insights.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

describe('GET /api/insights/mood (M3 Mood Insights API)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/insights', insightsRouter);
    app.use(errorHandler);

    const listening = app.listen(0);
    await new Promise<void>((resolve) => listening.once('listening', () => resolve()));
    server = listening;
    const addr = listening.address() as { port: number };
    baseUrl = 'http://127.0.0.1:' + addr.port;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('NEG-INSIGHT-01: unauthenticated request is rejected with 401', async () => {
    const res = await fetch(baseUrl + '/api/insights/mood');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('POS-INSIGHT-01: authenticated user receives valid MoodInsightResponse with timeline and distribution', async () => {
    const sampleData = {
      range: '30d' as const,
      totalEntries: 3,
      averageMoodScore: 4.33,
      timeline: [
        {
          date: '2026-09-01',
          averageScore: 4.0,
          entryCount: 1,
          dominantMood: 'joyful' as const,
          reasons: ['Delivered milestone on time'],
        },
        {
          date: '2026-09-02',
          averageScore: 4.5,
          entryCount: 2,
          dominantMood: 'joyful' as const,
          reasons: ['Zero-trust security verification passed'],
        },
      ],
      distribution: [
        { mood: 'joyful' as const, count: 3, percentage: 100.0 },
        { mood: 'calm' as const, count: 0, percentage: 0.0 },
        { mood: 'neutral' as const, count: 0, percentage: 0.0 },
        { mood: 'anxious' as const, count: 0, percentage: 0.0 },
        { mood: 'sad' as const, count: 0, percentage: 0.0 },
        { mood: 'angry' as const, count: 0, percentage: 0.0 },
        { mood: 'mixed' as const, count: 0, percentage: 0.0 },
      ],
      topTags: [
        { tag: 'security', count: 3 },
        { tag: 'milestone', count: 2 },
      ],
      highlights: [
        {
          id: 'e1',
          title: 'Security Milestone Done',
          mood: 'joyful' as const,
          moodScore: 5,
          moodReason: 'Zero-trust security verification passed',
          createdAt: '2026-09-02T10:00:00.000Z',
          tags: ['security', 'milestone'],
        },
      ],
    };

    mockInsightsService.getMoodInsights.mockResolvedValueOnce(sampleData);

    const res = await fetch(baseUrl + '/api/insights/mood?range=30d', {
      headers: { Authorization: 'Bearer token_user_alice' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();

    // Verify compliance with shared schema
    const parseResult = MoodInsightResponseSchema.safeParse(body.data);
    expect(parseResult.success).toBe(true);
    expect(body.data.totalEntries).toBe(3);
    expect(body.data.averageMoodScore).toBe(4.33);
    expect(body.data.timeline.length).toBe(2);
    expect(body.data.distribution.length).toBe(7);
  });

  it('POS-INSIGHT-02: empty entries returns clean empty dataset without crashing', async () => {
    const emptyData = {
      range: '7d' as const,
      totalEntries: 0,
      averageMoodScore: 0,
      timeline: [],
      distribution: [
        { mood: 'joyful' as const, count: 0, percentage: 0 },
        { mood: 'calm' as const, count: 0, percentage: 0 },
        { mood: 'neutral' as const, count: 0, percentage: 0 },
        { mood: 'anxious' as const, count: 0, percentage: 0 },
        { mood: 'sad' as const, count: 0, percentage: 0 },
        { mood: 'angry' as const, count: 0, percentage: 0 },
        { mood: 'mixed' as const, count: 0, percentage: 0 },
      ],
      topTags: [],
      highlights: [],
    };

    mockInsightsService.getMoodInsights.mockResolvedValueOnce(emptyData);

    const res = await fetch(baseUrl + '/api/insights/mood?range=7d', {
      headers: { Authorization: 'Bearer token_user_alice' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.totalEntries).toBe(0);
    expect(body.data.averageMoodScore).toBe(0);
    expect(body.data.timeline).toEqual([]);
  });

  it('NEG-INSIGHT-02: invalid range query gracefully falls back to default 30d range', async () => {
    const sampleData = {
      range: '30d' as const,
      totalEntries: 1,
      averageMoodScore: 3.0,
      timeline: [],
      distribution: [],
      topTags: [],
      highlights: [],
    };

    mockInsightsService.getMoodInsights.mockResolvedValueOnce(sampleData);

    const res = await fetch(baseUrl + '/api/insights/mood?range=invalid_range_hack', {
      headers: { Authorization: 'Bearer token_user_alice' },
    });

    expect(res.status).toBe(200);
    expect(mockInsightsService.getMoodInsights).toHaveBeenCalledWith('user_alice', '30d');
  });

  it('NEG-INSIGHT-03: malformed service output fails Zod schema validation with 500 error', async () => {
    // Return service data missing required fields or having out-of-spec values
    const brokenData = {
      range: '30d',
      totalEntries: 'invalid_type_string', // string instead of number
    };

    mockInsightsService.getMoodInsights.mockResolvedValueOnce(brokenData as any);

    const res = await fetch(baseUrl + '/api/insights/mood?range=30d', {
      headers: { Authorization: 'Bearer token_user_alice' },
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('NEG-INSIGHT-04: client-supplied uid in query or header is ignored (tenant isolation)', async () => {
    const sampleData = {
      range: '30d' as const,
      totalEntries: 0,
      averageMoodScore: 0,
      timeline: [],
      distribution: [],
      topTags: [],
      highlights: [],
    };

    mockInsightsService.getMoodInsights.mockResolvedValueOnce(sampleData);

    const res = await fetch(baseUrl + '/api/insights/mood?uid=victim_user&userId=attacker', {
      headers: {
        Authorization: 'Bearer token_user_alice',
        'x-user-id': 'spoofed_user',
      },
    });

    expect(res.status).toBe(200);
    // Verifies the backend called the service with verified token UID ONLY ('user_alice')
    expect(mockInsightsService.getMoodInsights).toHaveBeenCalledWith('user_alice', '30d');
  });

  it('POS-INSIGHT-03: supports 7d, 30d, and 90d query range options', async () => {
    const emptyData = {
      range: '90d' as const,
      totalEntries: 0,
      averageMoodScore: 0,
      timeline: [],
      distribution: [],
      topTags: [],
      highlights: [],
    };

    mockInsightsService.getMoodInsights.mockResolvedValueOnce(emptyData);

    const res = await fetch(baseUrl + '/api/insights/mood?range=90d', {
      headers: { Authorization: 'Bearer token_user_alice' },
    });

    expect(res.status).toBe(200);
    expect(mockInsightsService.getMoodInsights).toHaveBeenCalledWith('user_alice', '90d');
  });
});