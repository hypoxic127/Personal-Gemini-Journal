import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

// --- module doubles ------------------------------------------------------------------

const verifyIdToken = vi.fn(async (token: string, checkRevoked?: boolean) => {
  if (token === 'admin-token') {
    return { uid: 'admin_user_1', email: 'admin@example.com', role: 'admin' };
  }
  if (token === 'plain-token') {
    return { uid: 'plain_user_1', email: 'user@example.com', role: 'user' };
  }
  if (token === 'revoked-token') {
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
const mockUserDocGet = vi.fn().mockResolvedValue({
  exists: true,
  data: () => ({
    email: 'target@example.com',
    displayName: 'Target User',
    photoURL: null,
    role: 'user',
    createdAt: { toDate: () => new Date('2026-09-01T00:00:00.000Z') },
    lastActiveAt: { toDate: () => new Date('2026-09-02T00:00:00.000Z') },
    entryCount: 5,
  }),
});

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
  logAuditEvent: vi.fn().mockResolvedValue('log_123'),
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

// --- harness -------------------------------------------------------------------------

let server: Server;
let base: string;

const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (init.token) {
    headers.set('Authorization', `Bearer ${init.token}`);
  }
  return fetch(`${base}${path}`, { ...init, headers });
};

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  try {
    const adminMod = await import('../src/routes/admin.js');
    const adminRouter = adminMod.default || (adminMod as any).adminRouter;
    if (adminRouter) {
      app.use('/api/admin', adminRouter);
    }
  } catch (_err) {
    // Red-First TDD: admin routes will fail 404 until implemented
  }

  app.use(errorHandler);

  await new Promise<void>((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => {
      server = s;
      const addr = s.address();
      if (typeof addr === 'object' && addr && addr.port) {
        base = `http://127.0.0.1:${addr.port}`;
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
  audit.logAuditEvent.mockResolvedValue('log_123');
  setCustomUserClaims.mockResolvedValue(undefined);
  revokeRefreshTokens.mockResolvedValue(undefined);
});

// =====================================================================================
// --- 1. AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC) ---
// =====================================================================================

describe('M5 Admin RBAC: Authentication & Route Protection', () => {
  it('NEG-ADM-API-01: Unauthenticated GET /api/admin/stats returns 401 UNAUTHORIZED', async () => {
    const res = await call('/api/admin/stats');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe('UNAUTHORIZED');
    expect(aggregatesService.getAdminStats).not.toHaveBeenCalled();
    expect(audit.logAuditEvent).not.toHaveBeenCalled();
  });

  it('NEG-ADM-API-02: Plain user GET /api/admin/stats returns 403 FORBIDDEN', async () => {
    const res = await call('/api/admin/stats', { token: 'plain-token' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(aggregatesService.getAdminStats).not.toHaveBeenCalled();
    expect(audit.logAuditEvent).not.toHaveBeenCalled();
  });

  it('NEG-ADM-API-03: Unauthenticated GET /api/admin/users returns 401 UNAUTHORIZED', async () => {
    const res = await call('/api/admin/users');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe('UNAUTHORIZED');
    expect(usersService.listUsers).not.toHaveBeenCalled();
    expect(audit.logAuditEvent).not.toHaveBeenCalled();
  });

  it('NEG-ADM-API-04: Plain user GET /api/admin/users returns 403 FORBIDDEN', async () => {
    const res = await call('/api/admin/users', { token: 'plain-token' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(usersService.listUsers).not.toHaveBeenCalled();
    expect(audit.logAuditEvent).not.toHaveBeenCalled();
  });

  it('NEG-ADM-API-05: Unauthenticated POST /api/admin/users/:uid/role returns 401 UNAUTHORIZED', async () => {
    const res = await call('/api/admin/users/target_user_1/role', {
      method: 'POST',
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe('UNAUTHORIZED');
    expect(setCustomUserClaims).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
    expect(audit.logAuditEvent).not.toHaveBeenCalled();
  });

  it('NEG-ADM-API-06: Plain user POST /api/admin/users/:uid/role returns 403 FORBIDDEN', async () => {
    const res = await call('/api/admin/users/target_user_1/role', {
      method: 'POST',
      token: 'plain-token',
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(setCustomUserClaims).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
    expect(audit.logAuditEvent).not.toHaveBeenCalled();
  });

  it('NEG-ADM-API-12: Demoted admin using revoked token is rejected with 401 (immediate token revocation)', async () => {
    const res = await call('/api/admin/stats', { token: 'revoked-token' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });
});

// =====================================================================================
// --- 2. INPUT VALIDATION & ANTI-SELF-DEMOTION ---
// =====================================================================================

describe('M5 Admin RBAC: Role Mutation Validation & Anti-Self-Demotion', () => {
  it('NEG-ADM-API-07: Admin attempting self-demotion POST /api/admin/users/:selfUid/role returns 400 CANNOT_DEMOTE_SELF', async () => {
    // admin_user_1 is the caller's own verified UID from admin-token
    const res = await call('/api/admin/users/admin_user_1/role', {
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

  it('NEG-ADM-API-08: POST /api/admin/users/:uid/role with invalid role returns 400 BAD_REQUEST', async () => {
    const res = await call('/api/admin/users/target_user_1/role', {
      method: 'POST',
      token: 'admin-token',
      body: JSON.stringify({ role: 'superadmin' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(setCustomUserClaims).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
    expect(audit.logAuditEvent).not.toHaveBeenCalled();
  });

  it('NEG-ADM-API-09: POST /api/admin/users/:uid/role with extra unexpected fields returns 400 BAD_REQUEST (strict Zod)', async () => {
    const res = await call('/api/admin/users/target_user_1/role', {
      method: 'POST',
      token: 'admin-token',
      body: JSON.stringify({ role: 'admin', bypassCheck: true, isAdmin: true }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(setCustomUserClaims).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
    expect(audit.logAuditEvent).not.toHaveBeenCalled();
  });

  it('NEG-ADM-API-14: POST /api/admin/users/:uid/role with missing body returns 400 BAD_REQUEST', async () => {
    const res = await fetch(`${base}/api/admin/users/target_user_1/role`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-token',
        'Content-Type': 'application/json',
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe('BAD_REQUEST');
  });
});

// =====================================================================================
// --- 3. PRIVACY GUARANTEE & CONTENT ZERO-LEAKAGE ---
// =====================================================================================

describe('M5 Admin RBAC: Privacy Guarantee & Zero Content Leakage', () => {
  it('NEG-ADM-API-10: GET /api/admin/users response returns ZERO journal content, summaries, titles, tags, or locations', async () => {
    const mockUserItems = [
      {
        uid: 'target_u1',
        email: 'u1@example.com',
        displayName: 'Target One',
        photoURL: 'https://example.com/photo.jpg',
        role: 'user',
        createdAt: '2026-09-01T00:00:00.000Z',
        lastActiveAt: '2026-09-02T00:00:00.000Z',
        entryCount: 12,
      },
    ];

    usersService.listUsers.mockResolvedValueOnce({
      items: mockUserItems,
      nextCursor: null,
    });

    const res = await call('/api/admin/users', { token: 'admin-token' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.items).toBeInstanceOf(Array);
    expect(body.data.items).toHaveLength(1);

    const userItem = body.data.items[0];
    expect(userItem.uid).toBe('target_u1');
    expect(userItem.email).toBe('u1@example.com');
    expect(userItem.entryCount).toBe(12);

    // Strict structural check: assert zero diary content fields exist in the user object
    const forbiddenContentFields = [
      'summary',
      'title',
      'text',
      'content',
      'moodReason',
      'tags',
      'location',
      'lat',
      'lng',
      'placeName',
      'geohash',
    ];
    for (const forbiddenKey of forbiddenContentFields) {
      expect(userItem).not.toHaveProperty(forbiddenKey);
    }
  });

  it('NEG-ADM-API-11: GET /api/admin/stats returns suppressed: true and moodDistribution: null when active users < 5', async () => {
    const suppressedStats = {
      totalEntries: 8,
      activeUsers: 3, // < 5 active users -> privacy threshold triggers suppression
      suppressed: true,
      moodDistribution: null,
      averageMoodScore: null,
      dailyTrend: [
        { date: '2026-09-01', entries: 3, activeUsers: 2 },
        { date: '2026-09-02', entries: 5, activeUsers: 3 },
      ],
    };

    aggregatesService.getAdminStats.mockResolvedValueOnce(suppressedStats);

    const res = await call('/api/admin/stats', { token: 'admin-token' });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.suppressed).toBe(true);
    expect(body.data.moodDistribution).toBeNull();
    expect(body.data.averageMoodScore).toBeNull();
    expect(body.data.activeUsers).toBe(3);
    expect(body.data.totalEntries).toBe(8);
  });
});

// =====================================================================================
// --- 4. POSITIVE WORKFLOWS & AUDIT LOGGING ---
// =====================================================================================

describe('M5 Admin RBAC: Positive Workflows & Audit Logging', () => {
  it('POS-ADM-API-01: Admin GET /api/admin/stats returns structured aggregate payload and logs audit entry', async () => {
    const unsuppressedStats = {
      totalEntries: 42,
      activeUsers: 15, // >= 5 active users -> unsuppressed
      suppressed: false,
      moodDistribution: {
        joyful: 18,
        calm: 10,
        neutral: 6,
        anxious: 4,
        sad: 3,
        angry: 1,
        mixed: 0,
      },
      averageMoodScore: 3.6,
      dailyTrend: [
        { date: '2026-09-01', entries: 20, activeUsers: 10 },
        { date: '2026-09-02', entries: 22, activeUsers: 12 },
      ],
    };

    aggregatesService.getAdminStats.mockResolvedValueOnce(unsuppressedStats);

    const res = await call('/api/admin/stats', { token: 'admin-token' });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.suppressed).toBe(false);
    expect(body.data.activeUsers).toBe(15);
    expect(body.data.totalEntries).toBe(42);
    expect(body.data.moodDistribution).toBeDefined();
    expect(body.data.moodDistribution.joyful).toBe(18);
    expect(body.data.averageMoodScore).toBe(3.6);

    // Audit logging assertion
    expect(audit.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: 'admin_user_1',
        action: 'admin.stats.view',
      })
    );
  });

  it('POS-ADM-API-02: Admin GET /api/admin/users returns paginated user list and logs audit entry', async () => {
    const mockUserItems = [
      {
        uid: 'user_alpha',
        email: 'alpha@example.com',
        displayName: 'Alpha',
        photoURL: null,
        role: 'user',
        createdAt: '2026-09-01T00:00:00.000Z',
        lastActiveAt: '2026-09-02T00:00:00.000Z',
        entryCount: 4,
      },
      {
        uid: 'user_beta',
        email: 'beta@example.com',
        displayName: 'Beta',
        photoURL: null,
        role: 'admin',
        createdAt: '2026-08-20T00:00:00.000Z',
        lastActiveAt: '2026-09-02T00:00:00.000Z',
        entryCount: 20,
      },
    ];

    usersService.listUsers.mockResolvedValueOnce({
      items: mockUserItems,
      nextCursor: 'cursor_beta',
    });

    const res = await call('/api/admin/users?limit=20', { token: 'admin-token' });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0].uid).toBe('user_alpha');
    expect(body.data.items[0].role).toBe('user');
    expect(body.data.items[1].uid).toBe('user_beta');
    expect(body.data.items[1].role).toBe('admin');
    expect(body.data.nextCursor).toBe('cursor_beta');

    // Audit logging assertion
    expect(audit.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: 'admin_user_1',
        action: 'admin.users.list',
      })
    );
  });

  it('POS-ADM-API-03: Admin POST /api/admin/users/:targetUid/role updates claim, revokes tokens, updates display mirror, and logs role.grant audit entry', async () => {
    const res = await call('/api/admin/users/target_user_2/role', {
      method: 'POST',
      token: 'admin-token',
      body: JSON.stringify({ role: 'admin' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data?.ok).toBe(true);

    // 1. Firebase Custom Claims updated
    expect(setCustomUserClaims).toHaveBeenCalledWith('target_user_2', { role: 'admin' });
    // 2. Refresh tokens revoked immediately
    expect(revokeRefreshTokens).toHaveBeenCalledWith('target_user_2');
    // 3. Audit log entry recorded with role.grant
    expect(audit.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: 'admin_user_1',
        action: 'role.grant',
        targetUid: 'target_user_2',
      })
    );
  });

  it('POS-ADM-API-04: Admin demoting another user logs role.revoke audit entry', async () => {
    const res = await call('/api/admin/users/target_admin_3/role', {
      method: 'POST',
      token: 'admin-token',
      body: JSON.stringify({ role: 'user' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data?.ok).toBe(true);

    expect(setCustomUserClaims).toHaveBeenCalledWith('target_admin_3', { role: 'user' });
    expect(revokeRefreshTokens).toHaveBeenCalledWith('target_admin_3');
    expect(audit.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: 'admin_user_1',
        action: 'role.revoke',
        targetUid: 'target_admin_3',
      })
    );
  });

  it('NEG-ADM-API-13: GET /api/admin/users clamps limit exceeding 50 to MAX_PAGE_SIZE', async () => {
    usersService.listUsers.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });

    const res = await call('/api/admin/users?limit=5000', { token: 'admin-token' });
    expect(res.status).toBe(200);
    expect(usersService.listUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: expect.any(Number),
      })
    );
    const passedLimit = usersService.listUsers.mock.calls[0][0].limit;
    expect(passedLimit).toBeLessThanOrEqual(50);
  });
});
