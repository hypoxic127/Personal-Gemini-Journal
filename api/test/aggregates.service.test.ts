import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MoodEnum } from '@journal/shared';

const mockDocSet = vi.fn().mockResolvedValue(undefined);
const mockCollectionGet = vi.fn();
const mockUsersCollectionGet = vi.fn();

vi.mock('../src/firebase.js', () => ({
  db: {
    doc: vi.fn((path: string) => ({
      set: mockDocSet,
    })),
    collection: vi.fn((colName: string) => {
      if (colName === 'users') {
        return {
          get: mockUsersCollectionGet,
        };
      }
      return {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: mockCollectionGet,
      };
    }),
  },
  FieldValue: {
    serverTimestamp: () => 'SENTINEL_TIMESTAMP',
    increment: (n: number) => ({ incrementValue: n }),
  },
}));

import { recordEntryAggregate, getAdminStats } from '../src/services/aggregates.js';

describe('Aggregates Service (Population Insights & Privacy Guarantees)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordEntryAggregate', () => {
    it('atomically updates daily aggregate using nested object syntax without dotted paths', async () => {
      await recordEntryAggregate('joyful', '2026-09-02');

      expect(mockDocSet).toHaveBeenCalledTimes(1);
      const setPayload = mockDocSet.mock.calls[0][0];
      const setOptions = mockDocSet.mock.calls[0][1];

      expect(setOptions).toEqual({ merge: true });
      expect(setPayload.date).toBe('2026-09-02');
      expect(setPayload.totalEntries).toEqual({ incrementValue: 1 });
      expect(setPayload.moodDistribution).toBeDefined();
      expect(setPayload.moodDistribution.joyful).toEqual({ incrementValue: 1 });
      expect(setPayload.updatedAt).toBe('SENTINEL_TIMESTAMP');

      // Crucial Firestore check: ensure no dotted keys exist in the payload
      for (const key of Object.keys(setPayload)) {
        expect(key).not.toContain('.');
      }
    });
  });

  describe('getAdminStats: Privacy Small-Sample Suppression (< 5 active users)', () => {
    it('returns suppressed: true and null distributions when active users < 5', async () => {
      // 3 active users across 2 days
      mockUsersCollectionGet.mockResolvedValueOnce({
        docs: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }],
      });

      mockCollectionGet.mockResolvedValueOnce({
        docs: [
          {
            data: () => ({
              date: '2026-09-01',
              totalEntries: 2,
              activeUsers: 2,
              moodDistribution: { joyful: 2 },
            }),
          },
          {
            data: () => ({
              date: '2026-09-02',
              totalEntries: 3,
              activeUsers: 3,
              moodDistribution: { calm: 3 },
            }),
          },
        ],
      });

      const stats = await getAdminStats({ rangeDays: 30 });

      expect(stats.suppressed).toBe(true);
      expect(stats.activeUsers).toBe(3);
      expect(stats.totalEntries).toBe(5);
      expect(stats.moodDistribution).toBeNull();
      expect(stats.averageMoodScore).toBeNull();
      expect(stats.dailyTrend).toHaveLength(2);
      expect(stats.dailyTrend[0]).toEqual({ date: '2026-09-01', entries: 2, activeUsers: 2 });
    });

    it('returns suppressed: true and null distributions when totalEntries is 0', async () => {
      mockUsersCollectionGet.mockResolvedValueOnce({
        docs: [],
      });

      mockCollectionGet.mockResolvedValueOnce({
        docs: [],
      });

      const stats = await getAdminStats({ rangeDays: 30 });

      expect(stats.suppressed).toBe(true);
      expect(stats.activeUsers).toBe(0);
      expect(stats.totalEntries).toBe(0);
      expect(stats.moodDistribution).toBeNull();
      expect(stats.averageMoodScore).toBeNull();
      expect(stats.dailyTrend).toHaveLength(0);
    });
  });

  describe('getAdminStats: Unsuppressed Population Metrics (>= 5 active users)', () => {
    it('returns full population metrics and all 7 moods when active users >= 5', async () => {
      mockUsersCollectionGet.mockResolvedValueOnce({
        docs: [
          { id: 'u1' },
          { id: 'u2' },
          { id: 'u3' },
          { id: 'u4' },
          { id: 'u5' },
          { id: 'u6' },
        ],
      });

      mockCollectionGet.mockResolvedValueOnce({
        docs: [
          {
            data: () => ({
              date: '2026-09-01',
              totalEntries: 10,
              activeUsers: 5,
              moodDistribution: { joyful: 6, calm: 4 },
            }),
          },
          {
            data: () => ({
              date: '2026-09-02',
              totalEntries: 12,
              activeUsers: 6,
              moodDistribution: { joyful: 4, neutral: 5, anxious: 3 },
            }),
          },
        ],
      });

      const stats = await getAdminStats({ rangeDays: 30 });

      expect(stats.suppressed).toBe(false);
      expect(stats.activeUsers).toBe(6);
      expect(stats.totalEntries).toBe(22);
      expect(stats.moodDistribution).toBeDefined();
      expect(stats.moodDistribution).not.toBeNull();

      // All 7 moods must be represented
      for (const mood of MoodEnum.options) {
        expect(stats.moodDistribution).toHaveProperty(mood);
        expect(typeof stats.moodDistribution![mood]).toBe('number');
      }

      expect(stats.moodDistribution!.joyful).toBe(10);
      expect(stats.moodDistribution!.calm).toBe(4);
      expect(stats.moodDistribution!.neutral).toBe(5);
      expect(stats.moodDistribution!.anxious).toBe(3);
      expect(stats.moodDistribution!.sad).toBe(0);
      expect(stats.moodDistribution!.angry).toBe(0);
      expect(stats.moodDistribution!.mixed).toBe(0);

      expect(typeof stats.averageMoodScore).toBe('number');
      expect(stats.dailyTrend).toHaveLength(2);

      // Structural privacy check: verify zero personal data fields exist in returned object
      const forbiddenKeys = ['uid', 'userId', 'email', 'title', 'summary', 'text', 'tags', 'location'];
      for (const key of forbiddenKeys) {
        expect(stats).not.toHaveProperty(key);
      }
    });
  });
});
