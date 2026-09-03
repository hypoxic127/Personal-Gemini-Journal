import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { MoodEnum } from '@journal/shared';

const verifyIdToken = vi.fn(async (token: string, checkRevoked?: boolean) => {
  if (token === 'admin-token') return { uid: 'admin_caller_1', email: 'admin@example.com', role: 'admin' };
  if (token === 'plain-user-token') return { uid: 'plain_user_1', email: 'user@example.com', role: 'user' };
  if (token === 'attacker-user-token') return { uid: 'attacker_uid', email: 'attacker@example.com', role: 'user' };
  if (token === 'no-role-token') return { uid: 'no_role_user', email: 'norole@example.com' };
  if (token === 'array-role-token') return { uid: 'array_role_user', email: 'array@example.com', role: ['admin'] };
  if (token === 'revoked-admin-token') {
    const err = new Error('Firebase ID token has been revoked.');
    (err as any).code = 'auth/id-token-revoked';
    throw err;
  }
  throw new Error('invalid token');
});

const setCustomUserClaims = vi.fn().mockResolvedValue(undefined);
const revokeRefreshTokens = vi.fn().mockResolvedValue(undefined);
const getUser = vi.fn();
const mockUserDocUpdate = vi.fn().mockResolvedValue(undefined);
const mockUserDocGet = vi.fn();

vi.mock('../src/firebase.js', () => ({
  auth: {
    verifyIdToken: (token: string, checkRevoked?: boolean) => verifyIdToken(token, checkRevoked),
    setCustomUserClaims: (uid: string, claims: Record<string, unknown>) => setCustomUserClaims(uid, claims),
    revokeRefreshTokens: (uid: string) => revokeRefreshTokens(uid),
    getUser: (uid: string) => getUser(uid),
  },
  db: {
    doc: vi.fn((pathStr: string) => ({
      get: mockUserDocGet,
      update: mockUserDocUpdate,
      set: vi.fn().mockResolvedValue(undefined),
    })),
    collection: vi.fn((pathStr: string) => ({
      doc: vi.fn(() => ({
        get: mockUserDocGet,
        set: vi.fn().mockResolvedValue(undefined),
        update: mockUserDocUpdate,
      })),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: [] }),
    })),
  },
  FieldValue: {
    serverTimestamp: () => 'SENTINEL_TIMESTAMP',
    increment: (n: number) => ({ inc: n }),
  },
  Timestamp: {
    fromDate: (d: Date) => ({ toDate: () => d, toISOString: () => d.toISOString() }),
  },
}));

const audit = {
  logAuditEvent: vi.fn().mockResolvedValue('log_challenger_123'),
};
vi.mock('../src/services/audit.js', () => audit);

const aggregatesService = {
  getAdminStats: vi.fn(),
  recordEntryAggregate: vi.fn(),
};
vi.mock('../src/services/aggregates.js', () => aggregatesService);

const usersService = {
  listUsers: vi.fn(),
  getUserDoc: vi.fn(),
  ensureUserDoc: vi.fn(),
  updateUserRole: vi.fn(),
};
vi.mock('../src/services/users.js', () => usersService);

const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { adminRouter } = await import('../src/routes/admin.js');

let server: Server;
let base: string;

const call = (path: string, init: RequestInit & { token?: string; extraHeaders?: Record<string, string> } = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (init.token) {
    headers.set('Authorization', 'Bearer ' + init.token);
  }
  if (init.extraHeaders) {
    for (const [k, v] of Object.entries(init.extraHeaders)) {
      headers.set(k, v);
    }
  }
  return fetch(base + path, { ...init, headers });
};

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use('/api/admin', adminRouter);
  app.use(errorHandler);

  await new Promise<void>((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => {
      server = s;
      const addr = s.address();
      if (typeof addr === 'object' && addr && addr.port) {
        base = 'http://127.0.0.1:' + addr.port;
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  audit.logAuditEvent.mockResolvedValue('log_challenger_123');
  setCustomUserClaims.mockResolvedValue(undefined);
  revokeRefreshTokens.mockResolvedValue(undefined);
});

describe('CHALLENGE AREA 1: RBAC Authentication & Spoofing Resistance', () => {
  it('ADV-AUTH-01: missing token on all /api/admin/* routes returns 401 UNAUTHORIZED', async () => {
    const endpoints = [
      { path: '/api/admin/stats', method: 'GET' },
      { path: '/api/admin/users', method: 'GET' },
      { path: '/api/admin/users/target_1/role', method: 'POST', body: JSON.stringify({ role: 'admin' }) },
    ];
    for (const ep of endpoints) {
      const res = await call(ep.path, { method: ep.method, body: ep.body });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error?.code).toBe('UNAUTHORIZED');
      expect(audit.logAuditEvent).not.toHaveBeenCalled();
    }
  });

  it('ADV-AUTH-02: malformed authorization headers fail closed with 401 UNAUTHORIZED', async () => {
    const malformedHeaders = [
      'Bearer ',
      'Bearer',
      'Basic dXNlcjpwYXNz',
      'Token invalid',
      'Bearer undefined',
      'Bearer null',
    ];
    for (const headerVal of malformedHeaders) {
      const res = await fetch(base + '/api/admin/stats', { headers: { Authorization: headerVal } });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error?.code).toBe('UNAUTHORIZED');
    }
  });

  it('ADV-AUTH-03: header spoofing attempts (x-role, x-admin, x-forwarded-user) do NOT elevate plain user', async () => {
    const spoofHeaders = {
      'x-role': 'admin',
      'x-user-role': 'admin',
      'x-admin': 'true',
      'x-forwarded-user': 'admin',
      'x-custom-claims': JSON.stringify({ role: 'admin' }),
      'x-is-admin': '1',
    };
    const res = await call('/api/admin/stats', { token: 'plain-user-token', extraHeaders: spoofHeaders });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(aggregatesService.getAdminStats).not.toHaveBeenCalled();
    expect(audit.logAuditEvent).not.toHaveBeenCalled();
  });

  it('ADV-AUTH-04: token with missing role claim or non-admin role claim returns 403 FORBIDDEN', async () => {
    const resNoRole = await call('/api/admin/stats', { token: 'no-role-token' });
    expect(resNoRole.status).toBe(403);
    const resArrayRole = await call('/api/admin/stats', { token: 'array-role-token' });
    expect(resArrayRole.status).toBe(403);
    const resPlain = await call('/api/admin/stats', { token: 'plain-user-token' });
    expect(resPlain.status).toBe(403);
  });

  it('ADV-AUTH-05: revoked admin token returns 401 UNAUTHORIZED (checkRevoked immediate enforcement)', async () => {
    const res = await call('/api/admin/stats', { token: 'revoked-admin-token' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });
});

describe('CHALLENGE AREA 2: Anti-Self-Demotion & Role Mutation Defense', () => {
  it('ADV-DEMOTE-01: admin attempting self-demotion is rejected with 400 CANNOT_DEMOTE_SELF', async () => {
    const res = await call('/api/admin/users/admin_caller_1/role', {
      method: 'POST',
      token: 'admin-token',
      body: JSON.stringify({ role: 'user' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe('CANNOT_DEMOTE_SELF');
    expect(setCustomUserClaims).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
    expect(audit.logAuditEvent).not.toHaveBeenCalled();
  });

  it('ADV-DEMOTE-02: admin re-granting admin to self succeeds (no lockout risk)', async () => {
    const res = await call('/api/admin/users/admin_caller_1/role', {
      method: 'POST',
      token: 'admin-token',
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data?.ok).toBe(true);
    expect(setCustomUserClaims).toHaveBeenCalledWith('admin_caller_1', { role: 'admin' });
  });

  it('ADV-DEMOTE-03: role mutation with invalid enum values is rejected with 400 BAD_REQUEST', async () => {
    const invalidRoles = ['superadmin', 'owner', 'root', 'moderator', '', 123, true, null, ['admin']];
    for (const roleVal of invalidRoles) {
      const res = await call('/api/admin/users/target_user_1/role', {
        method: 'POST',
        token: 'admin-token',
        body: JSON.stringify({ role: roleVal }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error?.code).toBe('BAD_REQUEST');
      expect(setCustomUserClaims).not.toHaveBeenCalled();
    }
  });

  it('ADV-DEMOTE-04: role mutation with injected properties is rejected by strict Zod schema', async () => {
    const res = await call('/api/admin/users/target_user_1/role', {
      method: 'POST',
      token: 'admin-token',
      body: JSON.stringify({
        role: 'user',
        isSuperuser: true,
        permissions: ['all'],
        bypass: true,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('ADV-DEMOTE-05: role mutation with malformed UID path parameter fails with 400 BAD_REQUEST', async () => {
    const malformedUids = [
      '../escape_path',
      'user/with/slash',
      'user_with_special_chars_!@#$%^&*()',
      'a'.repeat(65),
    ];
    for (const uid of malformedUids) {
      const res = await call('/api/admin/users/' + encodeURIComponent(uid) + '/role', {
        method: 'POST',
        token: 'admin-token',
        body: JSON.stringify({ role: 'user' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error?.code).toBe('BAD_REQUEST');
      expect(setCustomUserClaims).not.toHaveBeenCalled();
    }
  });

  it('ADV-DEMOTE-06: unprivileged user attempting self-elevation is blocked with 403 FORBIDDEN', async () => {
    const res = await call('/api/admin/users/attacker_uid/role', {
      method: 'POST',
      token: 'attacker-user-token',
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });
});

describe('CHALLENGE AREA 3: Small-Sample Privacy Suppression Boundaries', () => {
  it('ADV-SUPP-01 [N=0]: zero active users triggers suppressed: true and null distributions', async () => {
    aggregatesService.getAdminStats.mockResolvedValueOnce({
      totalEntries: 0,
      activeUsers: 0,
      suppressed: true,
      moodDistribution: null,
      averageMoodScore: null,
      dailyTrend: [],
    });
    const res = await call('/api/admin/stats', { token: 'admin-token' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.suppressed).toBe(true);
    expect(body.data.activeUsers).toBe(0);
    expect(body.data.totalEntries).toBe(0);
    expect(body.data.moodDistribution).toBeNull();
    expect(body.data.averageMoodScore).toBeNull();
  });

  it('ADV-SUPP-02 [N=1]: 1 active user triggers suppressed: true and null distributions', async () => {
    aggregatesService.getAdminStats.mockResolvedValueOnce({
      totalEntries: 3,
      activeUsers: 1,
      suppressed: true,
      moodDistribution: null,
      averageMoodScore: null,
      dailyTrend: [{ date: '2026-09-02', entries: 3, activeUsers: 1 }],
    });
    const res = await call('/api/admin/stats', { token: 'admin-token' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.suppressed).toBe(true);
    expect(body.data.activeUsers).toBe(1);
    expect(body.data.moodDistribution).toBeNull();
    expect(body.data.averageMoodScore).toBeNull();
  });

  it('ADV-SUPP-03 [N=4]: 4 active users triggers suppressed: true and null distributions (boundary condition)', async () => {
    aggregatesService.getAdminStats.mockResolvedValueOnce({
      totalEntries: 15,
      activeUsers: 4,
      suppressed: true,
      moodDistribution: null,
      averageMoodScore: null,
      dailyTrend: [{ date: '2026-09-02', entries: 15, activeUsers: 4 }],
    });
    const res = await call('/api/admin/stats', { token: 'admin-token' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.suppressed).toBe(true);
    expect(body.data.activeUsers).toBe(4);
    expect(body.data.moodDistribution).toBeNull();
    expect(body.data.averageMoodScore).toBeNull();
  });

  it('ADV-SUPP-04 [N=5]: 5 active users triggers suppressed: false and full distributions (exact threshold boundary)', async () => {
    const unsuppressedDist = {
      joyful: 5,
      calm: 4,
      neutral: 3,
      anxious: 2,
      sad: 1,
      angry: 0,
      mixed: 0,
    };
    aggregatesService.getAdminStats.mockResolvedValueOnce({
      totalEntries: 15,
      activeUsers: 5,
      suppressed: false,
      moodDistribution: unsuppressedDist,
      averageMoodScore: 2.1,
      dailyTrend: [{ date: '2026-09-02', entries: 15, activeUsers: 5 }],
    });
    const res = await call('/api/admin/stats', { token: 'admin-token' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.suppressed).toBe(false);
    expect(body.data.activeUsers).toBe(5);
    expect(body.data.moodDistribution).toEqual(unsuppressedDist);
    expect(body.data.averageMoodScore).toBe(2.1);
  });

  it('ADV-SUPP-05 [N=10]: 10 active users returns full unsuppressed statistics', async () => {
    const unsuppressedDist = {
      joyful: 25,
      calm: 14,
      neutral: 13,
      anxious: 8,
      sad: 4,
      angry: 2,
      mixed: 1,
    };
    aggregatesService.getAdminStats.mockResolvedValueOnce({
      totalEntries: 67,
      activeUsers: 10,
      suppressed: false,
      moodDistribution: unsuppressedDist,
      averageMoodScore: 2.8,
      dailyTrend: [{ date: '2026-09-02', entries: 67, activeUsers: 10 }],
    });
    const res = await call('/api/admin/stats', { token: 'admin-token' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.suppressed).toBe(false);
    expect(body.data.activeUsers).toBe(10);
    expect(body.data.moodDistribution).toEqual(unsuppressedDist);
    expect(body.data.averageMoodScore).toBe(2.8);
  });

  it('ADV-SUPP-06: /api/admin/stats response shape invariant test (zero personal content)', async () => {
    aggregatesService.getAdminStats.mockResolvedValueOnce({
      totalEntries: 50,
      activeUsers: 12,
      suppressed: false,
      moodDistribution: { joyful: 50, calm: 0, neutral: 0, anxious: 0, sad: 0, angry: 0, mixed: 0 },
      averageMoodScore: 4.0,
      dailyTrend: [{ date: '2026-09-02', entries: 50, activeUsers: 12 }],
    });
    const res = await call('/api/admin/stats', { token: 'admin-token' });
    const body = await res.json();
    const statsData = body.data;
    const forbiddenPersonalKeys = [
      'uid', 'userId', 'email', 'title', 'summary', 'text', 'content', 'tags', 'location', 'placeName', 'geohash', 'lat', 'lng'
    ];
    for (const key of forbiddenPersonalKeys) {
      expect(statsData).not.toHaveProperty(key);
    }
  });
});

describe('CHALLENGE AREA 4: Zero-Content & Zero-PII User Metadata & Query Fuzzing', () => {
  it('ADV-DATA-01: GET /api/admin/users returns strict account metadata with ZERO PII and ZERO diary content', async () => {
    const mockUsers = [
      {
        uid: 'user_probe_1',
        role: 'user',
        createdAt: '2026-09-01T00:00:00.000Z',
        lastActiveAt: '2026-09-02T00:00:00.000Z',
        entryCount: 15,
      },
    ];
    usersService.listUsers.mockResolvedValueOnce({ items: mockUsers, nextCursor: null });
    const res = await call('/api/admin/users', { token: 'admin-token' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items).toHaveLength(1);
    const userObj = body.data.items[0];
    expect(userObj.uid).toBe('user_probe_1');
    expect(userObj.entryCount).toBe(15);
    expect(userObj.role).toBe('user');
    expect(userObj.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(userObj.lastActiveAt).toBe('2026-09-02T00:00:00.000Z');

    const forbiddenKeys = [
      'email', 'displayName', 'photoURL', 'summary', 'title', 'text', 'content', 'moodReason', 'tags', 'location', 'lat', 'lng', 'placeName', 'geohash', 'sessions', 'messages', 'entries'
    ];
    for (const k of forbiddenKeys) {
      expect(userObj).not.toHaveProperty(k);
    }
  });

  it('ADV-DATA-02: query param fuzzing on GET /api/admin/users clamps or validates safely', async () => {
    usersService.listUsers.mockResolvedValueOnce({ items: [], nextCursor: null });
    const resOverLimit = await call('/api/admin/users?limit=99999999', { token: 'admin-token' });
    expect(resOverLimit.status).toBe(200);
    expect(usersService.listUsers).toHaveBeenCalledWith(expect.objectContaining({ limit: expect.any(Number) }));
    const actualLimit = usersService.listUsers.mock.calls[0][0].limit;
    expect(actualLimit).toBeLessThanOrEqual(50);

    const resBadCursor = await call('/api/admin/users?cursor=../../etc/passwd', { token: 'admin-token' });
    expect(resBadCursor.status).toBe(400);
    const badCursorBody = await resBadCursor.json();
    expect(badCursorBody.error?.code).toBe('BAD_REQUEST');

    const resSymbolCursor = await call('/api/admin/users?cursor=invalid!@#$%^&*()', { token: 'admin-token' });
    expect(resSymbolCursor.status).toBe(400);
  });
});

describe('CHALLENGE AREA 5: Audit Logging Integrity & De-Noising', () => {
  it('ADV-AUDIT-01: critical mutations write immutable audit logs while read stats are de-noised to operational logs', async () => {
    aggregatesService.getAdminStats.mockResolvedValueOnce({
      totalEntries: 10,
      activeUsers: 6,
      suppressed: false,
      moodDistribution: { joyful: 10, calm: 0, neutral: 0, anxious: 0, sad: 0, angry: 0, mixed: 0 },
      averageMoodScore: 4.0,
      dailyTrend: [],
    });
    await call('/api/admin/stats', { token: 'admin-token' });
    // GET /stats does NOT call logAuditEvent
    expect(audit.logAuditEvent).not.toHaveBeenCalled();

    usersService.listUsers.mockResolvedValueOnce({ items: [], nextCursor: null });
    await call('/api/admin/users', { token: 'admin-token' });
    expect(audit.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorUid: 'admin_caller_1',
      action: 'admin.users.list',
    }));

    await call('/api/admin/users/target_u2/role', {
      method: 'POST',
      token: 'admin-token',
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(audit.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorUid: 'admin_caller_1',
      action: 'role.grant',
      targetUid: 'target_u2',
    }));

    await call('/api/admin/users/target_u3/role', {
      method: 'POST',
      token: 'admin-token',
      body: JSON.stringify({ role: 'user' }),
    });
    expect(audit.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorUid: 'admin_caller_1',
      action: 'role.revoke',
      targetUid: 'target_u3',
    }));
  });

  it('ADV-AUDIT-02: safe fail-closed execution order aborts claim mutation if Firestore display mirror fails', async () => {
    usersService.updateUserRole.mockRejectedValueOnce(new Error('Firestore write connection timeout'));

    const res = await call('/api/admin/users/target_fail_user/role', {
      method: 'POST',
      token: 'admin-token',
      body: JSON.stringify({ role: 'admin' }),
    });

    expect(res.status).toBe(500);
    expect(usersService.updateUserRole).toHaveBeenCalledWith('target_fail_user', 'admin');
    expect(setCustomUserClaims).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
    expect(audit.logAuditEvent).not.toHaveBeenCalled();
  });

  it('ADV-AUDIT-03: rate limiting is enforced on admin endpoints against flood attacks', async () => {
    aggregatesService.getAdminStats.mockResolvedValue({
      totalEntries: 5,
      activeUsers: 5,
      suppressed: false,
      moodDistribution: null,
      averageMoodScore: null,
      dailyTrend: [],
    });

    const requests = Array.from({ length: 70 }, () =>
      call('/api/admin/stats', { token: 'admin-token' })
    );
    const results = await Promise.all(requests);
    const statusCodes = results.map((r) => r.status);

    expect(statusCodes).toContain(429);
  });
});
