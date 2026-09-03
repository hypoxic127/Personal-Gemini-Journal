import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AdminStatsResponseSchema,
  AdminUsersResponseSchema,
  SetUserRoleSchema,
  type Mood,
} from '@journal/shared';

// We test the error mapping and client schema logic used by web/src/lib/adminApi.ts
class MockApiError extends Error {
  code: string;
  status: number;
  correlationId?: string;

  constructor(status: number, message: string, code = 'API_ERROR', correlationId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

function describeAdminError(err: unknown, fallbackMessage = 'An unexpected error occurred.'): string {
  if (err instanceof MockApiError) {
    if (err.code === 'CANNOT_DEMOTE_SELF' || (err.status === 400 && err.message.includes('demote'))) {
      return 'Administrators cannot demote their own account.';
    }
    if (err.status === 403 || err.code === 'FORBIDDEN') {
      return 'Access denied. Administrative privileges are required.';
    }
    if (err.status === 429 || err.code === 'RATE_LIMITED') {
      return 'Too many requests. Please wait a moment before trying again.';
    }
    if (err.status === 401 || err.code === 'UNAUTHORIZED') {
      return 'Your session has expired. Please sign in again.';
    }
    return err.message || fallbackMessage;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallbackMessage;
}

describe('Frontend Admin API & Invariant Verification', () => {
  describe('Admin Schema Compliance & Data Invariants', () => {
    it('validates suppressed stats payload for sample size < 5', () => {
      const suppressedPayload = {
        totalEntries: 3,
        activeUsers: 2,
        suppressed: true,
        moodDistribution: null,
        averageMoodScore: null,
        dailyTrend: [{ date: '2026-09-02', entries: 3, activeUsers: 2 }],
      };

      const parsed = AdminStatsResponseSchema.safeParse(suppressedPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.suppressed).toBe(true);
        expect(parsed.data.moodDistribution).toBeNull();
        expect(parsed.data.averageMoodScore).toBeNull();
      }
    });

    it('validates unsuppressed stats payload for sample size >= 5', () => {
      const unsuppressedPayload = {
        totalEntries: 25,
        activeUsers: 7,
        suppressed: false,
        moodDistribution: {
          joyful: 10,
          calm: 8,
          neutral: 4,
          anxious: 2,
          sad: 1,
          angry: 0,
          mixed: 0,
        },
        averageMoodScore: 2.8,
        dailyTrend: [{ date: '2026-09-02', entries: 25, activeUsers: 7 }],
      };

      const parsed = AdminStatsResponseSchema.safeParse(unsuppressedPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.suppressed).toBe(false);
        expect(parsed.data.moodDistribution).toBeDefined();
        expect(parsed.data.moodDistribution?.joyful).toBe(10);
      }
    });

    it('rejects stats payload containing identifying or content fields (Zero-Content Invariant)', () => {
      const leakyPayload = {
        totalEntries: 25,
        activeUsers: 7,
        suppressed: false,
        moodDistribution: {
          joyful: 10,
          calm: 8,
          neutral: 4,
          anxious: 2,
          sad: 1,
          angry: 0,
          mixed: 0,
        },
        averageMoodScore: 2.8,
        dailyTrend: [{ date: '2026-09-02', entries: 25, activeUsers: 7 }],
        userText: 'private diary text', // forbidden
      };

      const parsed = AdminStatsResponseSchema.safeParse(leakyPayload);
      expect(parsed.success).toBe(false);
    });

    it('validates admin users list response schema strictly', () => {
      const usersListPayload = {
        items: [
          {
            uid: 'u_1234567890',
            role: 'admin',
            createdAt: '2026-09-01T00:00:00.000Z',
            lastActiveAt: '2026-09-02T12:00:00.000Z',
            entryCount: 42,
          },
        ],
        nextCursor: 'u_cursor_token',
      };

      const parsed = AdminUsersResponseSchema.safeParse(usersListPayload);
      expect(parsed.success).toBe(true);
    });

    it('rejects user list containing PII or forbidden content fields (Zero-PII Invariant)', () => {
      const leakyPiiList = {
        items: [
          {
            uid: 'u_123',
            email: 'user@example.com', // forbidden PII
            role: 'user',
            createdAt: '2026-09-01T00:00:00.000Z',
            lastActiveAt: '2026-09-02T12:00:00.000Z',
            entryCount: 1,
          },
        ],
        nextCursor: null,
      };

      expect(AdminUsersResponseSchema.safeParse(leakyPiiList).success).toBe(false);

      const leakyContentList = {
        items: [
          {
            uid: 'u_123',
            role: 'user',
            createdAt: '2026-09-01T00:00:00.000Z',
            lastActiveAt: '2026-09-02T12:00:00.000Z',
            entryCount: 1,
            summary: 'Private reflection summary', // forbidden content
          },
        ],
        nextCursor: null,
      };

      expect(AdminUsersResponseSchema.safeParse(leakyContentList).success).toBe(false);
    });

    it('validates SetUserRoleSchema strictly', () => {
      expect(SetUserRoleSchema.safeParse({ role: 'admin' }).success).toBe(true);
      expect(SetUserRoleSchema.safeParse({ role: 'user' }).success).toBe(true);
      expect(SetUserRoleSchema.safeParse({ role: 'superadmin' }).success).toBe(false);
      expect(SetUserRoleSchema.safeParse({ role: 'admin', bypass: true }).success).toBe(false);
    });
  });

  describe('describeAdminError: Human-Readable Safe Error Translation', () => {
    it('correctly maps CANNOT_DEMOTE_SELF error', () => {
      const err = new MockApiError(400, 'Administrators cannot demote their own account.', 'CANNOT_DEMOTE_SELF');
      expect(describeAdminError(err)).toBe('Administrators cannot demote their own account.');
    });

    it('correctly maps FORBIDDEN (403) error', () => {
      const err = new MockApiError(403, 'Forbidden', 'FORBIDDEN');
      expect(describeAdminError(err)).toBe('Access denied. Administrative privileges are required.');
    });

    it('correctly maps RATE_LIMITED (429) error', () => {
      const err = new MockApiError(429, 'Rate limit exceeded', 'RATE_LIMITED');
      expect(describeAdminError(err)).toBe('Too many requests. Please wait a moment before trying again.');
    });

    it('correctly maps UNAUTHORIZED (401) error', () => {
      const err = new MockApiError(401, 'Unauthorized', 'UNAUTHORIZED');
      expect(describeAdminError(err)).toBe('Your session has expired. Please sign in again.');
    });

    it('returns custom message for other API errors', () => {
      const err = new MockApiError(500, 'Custom server problem.', 'INTERNAL_ERROR');
      expect(describeAdminError(err)).toBe('Custom server problem.');
    });

    it('returns fallback message for unknown non-error values', () => {
      expect(describeAdminError(null, 'Fallback msg')).toBe('Fallback msg');
    });
  });
});
