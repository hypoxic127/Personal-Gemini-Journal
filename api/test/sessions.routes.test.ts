import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

// --- module doubles ------------------------------------------------------------------
// Firestore and Gemini are mocked; what is under test is the route layer: authentication,
// Zod strictness, server-side truncation, history capping, and failure reporting.

const verifyIdToken = vi.fn(async (token: string) => {
  if (!token.startsWith('t:')) throw new Error('invalid token');
  return { uid: token.slice(2), email: `${token.slice(2)}@example.com` };
});

vi.mock('../src/firebase.js', () => ({
  auth: { verifyIdToken: (token: string) => verifyIdToken(token) },
  db: {},
  FieldValue: { serverTimestamp: () => 'SENTINEL', increment: (n: number) => ({ inc: n }) },
  Timestamp: {},
}));

const sessions = {
  createSession: vi.fn(),
  listSessions: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
  listMessages: vi.fn(),
  appendUserMessage: vi.fn(),
  appendModelMessage: vi.fn(),
  recentHistory: vi.fn(),
  finalizeSession: vi.fn(),
  listEntries: vi.fn(),
  getEntry: vi.fn(),
};
vi.mock('../src/services/sessions.js', () => sessions);

const gemini = {
  generateChatReply: vi.fn(),
  generateEntryDraft: vi.fn(),
};
vi.mock('../src/services/gemini.js', () => gemini);

const { default: sessionsRouter } = await import('../src/routes/sessions.js');
const { default: entriesRouter } = await import('../src/routes/entries.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { MESSAGE_TEXT_LIMIT, MAX_HISTORY_TURNS } = await import('@journal/shared');

// --- harness -------------------------------------------------------------------------

let server: Server;
let base: string;

const session = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  title: 'A reflection',
  status: 'active',
  messageCount: 2,
  entryId: null,
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  ...over,
});

const message = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  role: 'user',
  text: 'hello',
  createdAt: '2026-09-02T00:00:00.000Z',
  ...over,
});

const call = (path: string, init: RequestInit & { uid?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (init.uid) headers.set('Authorization', `Bearer t:${init.uid}`);
  return fetch(`${base}${path}`, { ...init, headers });
};

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/entries', entriesRouter);
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

beforeEach(async () => {
  for (const fn of Object.values(sessions)) fn.mockReset();
  for (const fn of Object.values(gemini)) fn.mockReset();

  sessions.getSession.mockResolvedValue(session());
  sessions.recentHistory.mockResolvedValue([]);
  sessions.appendUserMessage.mockImplementation(async (_uid, _sid, text) =>
    message({ id: 'm-user', role: 'user', text })
  );
  sessions.listMessages.mockResolvedValue({ items: [], nextCursor: null });
  sessions.appendModelMessage.mockResolvedValue(message({ id: 'm-model', role: 'model', text: 'reply' }));
  gemini.generateChatReply.mockResolvedValue({ text: 'reply', model: 'ladder-model' });
});

// --- authentication ------------------------------------------------------------------

describe('authentication', () => {
  it('NEG-SESAPI-01: every session and entry route rejects an unauthenticated caller with 401', async () => {
    const routes: Array<[string, string, unknown?]> = [
      ['POST', '/api/sessions', {}],
      ['GET', '/api/sessions'],
      ['GET', '/api/sessions/s1'],
      ['DELETE', '/api/sessions/s1'],
      ['GET', '/api/sessions/s1/messages'],
      ['POST', '/api/sessions/s1/messages', { text: 'hi' }],
      ['POST', '/api/sessions/s1/finalize', {}],
      ['GET', '/api/entries'],
      ['GET', '/api/entries/e1'],
    ];

    for (const [method, path, body] of routes) {
      const res = await call(path, { method, body: body ? JSON.stringify(body) : undefined });
      expect(res.status, `${method} ${path}`).toBe(401);
    }

    expect(sessions.createSession).not.toHaveBeenCalled();
    expect(gemini.generateChatReply).not.toHaveBeenCalled();
  });

  it('NEG-SESAPI-02: a malformed token is rejected without reaching the data layer', async () => {
    const res = await fetch(`${base}/api/sessions`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });

    expect(res.status).toBe(401);
    expect(sessions.listSessions).not.toHaveBeenCalled();
  });
});

// --- isolation -----------------------------------------------------------------------

describe('data isolation', () => {
  it('NEG-SESAPI-03: data access keys on the token uid, never on anything the client sends', async () => {
    sessions.listSessions.mockResolvedValue({ items: [], nextCursor: null });

    // A smuggled uid is not quietly ignored — the strict query schema rejects it outright,
    // so an attempt to steer the query shows up as a 400 instead of passing unnoticed.
    const smuggled = await call('/api/sessions?uid=userB&userId=userB', { uid: 'userA' });
    expect(smuggled.status).toBe(400);
    expect(sessions.listSessions).not.toHaveBeenCalled();

    // And the clean request reads only the caller's own subtree.
    await call('/api/sessions', { uid: 'userA' });
    expect(sessions.listSessions).toHaveBeenCalledWith('userA', expect.anything());
  });

  it("NEG-SESAPI-04: another user's session id resolves under the caller's own subtree and 404s", async () => {
    sessions.getSession.mockResolvedValue(null);

    const res = await call('/api/sessions/session-belonging-to-userB/messages', {
      method: 'POST',
      uid: 'userA',
      body: JSON.stringify({ text: 'give me their diary' }),
    });

    expect(res.status).toBe(404);
    expect(sessions.getSession).toHaveBeenCalledWith('userA', 'session-belonging-to-userB');
    expect(gemini.generateChatReply).not.toHaveBeenCalled();
    expect(sessions.appendUserMessage).not.toHaveBeenCalled();
  });
});

// --- input validation ----------------------------------------------------------------

describe('input validation', () => {
  it('NEG-SESAPI-05: an unknown field is a 400, not a silent ignore', async () => {
    const res = await call('/api/sessions/s1/messages', {
      method: 'POST',
      uid: 'v1',
      body: JSON.stringify({ text: 'hi', role: 'model', uid: 'userB', createdAt: '1999-01-01' }),
    });

    expect(res.status).toBe(400);
    expect(sessions.appendUserMessage).not.toHaveBeenCalled();
  });

  it('NEG-SESAPI-06: an empty or whitespace-only message is a 400', async () => {
    for (const text of ['', '   ']) {
      const res = await call('/api/sessions/s1/messages', {
        method: 'POST',
        uid: 'v2',
        body: JSON.stringify({ text }),
      });
      expect(res.status).toBe(400);
    }
    expect(sessions.appendUserMessage).not.toHaveBeenCalled();
  });

  it('NEG-SESAPI-07: a missing body is a clean 400, never an unhandled throw', async () => {
    const res = await fetch(`${base}/api/sessions/s1/messages`, {
      method: 'POST',
      headers: { Authorization: 'Bearer t:v3', 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('TypeError');
  });

  it('NEG-SESAPI-08: input is truncated to the limit SERVER-side, not trusted from the form', async () => {
    const res = await call('/api/sessions/s1/messages', {
      method: 'POST',
      uid: 'v4',
      body: JSON.stringify({ text: 'x'.repeat(9000) }),
    });

    expect(res.status).toBe(200);
    const storedText = sessions.appendUserMessage.mock.calls[0][2];
    expect(storedText).toHaveLength(MESSAGE_TEXT_LIMIT);
  });

  it('NEG-SESAPI-09: conversation history sent to the model is capped', async () => {
    await call('/api/sessions/s1/messages', {
      method: 'POST',
      uid: 'v5',
      body: JSON.stringify({ text: 'hi' }),
    });

    expect(sessions.recentHistory).toHaveBeenCalledWith('v5', 's1', MAX_HISTORY_TURNS);
  });

  it('NEG-SESAPI-10: a page size beyond the server maximum is clamped, not honoured', async () => {
    sessions.listEntries.mockResolvedValue({ items: [], nextCursor: null });

    await call('/api/entries?limit=5000', { uid: 'v6' });

    const { limit } = sessions.listEntries.mock.calls[0][1];
    expect(limit).toBeLessThanOrEqual(50);
  });
});

// --- persistence and failure reporting -----------------------------------------------

describe('guaranteed save verification', () => {
  it('POS-SESAPI-01: a successful turn persists the user message and the model reply', async () => {
    const res = await call('/api/sessions/s1/messages', {
      method: 'POST',
      uid: 'p1',
      body: JSON.stringify({ text: 'hello there' }),
    });

    expect(res.status).toBe(200);
    expect(sessions.appendUserMessage).toHaveBeenCalledTimes(1);
    expect(sessions.appendModelMessage).toHaveBeenCalledTimes(1);

    const body = await res.json();
    expect(body.data.userMessage.text).toBe('hello there');
    expect(body.data.modelMessage.text).toBe('reply');
  });

  it('NEG-SESAPI-11: a failed model-reply write reports SAVE_FAILED instead of returning success', async () => {
    sessions.appendModelMessage.mockRejectedValue(new Error('firestore unavailable'));

    const res = await call('/api/sessions/s1/messages', {
      method: 'POST',
      uid: 'p2',
      body: JSON.stringify({ text: 'hello' }),
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('SAVE_FAILED');
    expect(body.error.message).not.toContain('firestore unavailable');
  });

  it('NEG-SESAPI-12: when the model is unavailable the user message stays saved and the client is told', async () => {
    const aiDown = Object.assign(new Error('all rungs down'), {
      statusCode: 503,
      code: 'AI_UNAVAILABLE',
      isOperational: true,
    });
    gemini.generateChatReply.mockRejectedValue(aiDown);

    const res = await call('/api/sessions/s1/messages', {
      method: 'POST',
      uid: 'p3',
      body: JSON.stringify({ text: 'keep this text' }),
    });

    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('AI_UNAVAILABLE');
    // The user's own words were committed before the model was ever called.
    expect(sessions.appendUserMessage).toHaveBeenCalledTimes(1);
  });
});

// --- finalize ------------------------------------------------------------------------

describe('finalize', () => {
  it('POS-SESAPI-02: a valid draft is written as an entry', async () => {
    sessions.recentHistory.mockResolvedValue([{ role: 'user', text: 'Today was long.' }]);
    gemini.generateEntryDraft.mockResolvedValue({
      draft: {
        title: 'A day',
        summary: 'Something happened.',
        mood: 'calm',
        moodScore: 2,
        moodReason: 'Settled.',
        tags: ['life'],
      },
      model: 'ladder-model',
    });
    sessions.finalizeSession.mockResolvedValue({
      id: 'e1',
      sessionId: 's1',
      title: 'A day',
      summary: 'Something happened.',
      mood: 'calm',
      moodScore: 2,
      moodReason: 'Settled.',
      tags: ['life'],
      location: null,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    });

    const res = await call('/api/sessions/s1/finalize', {
      method: 'POST',
      uid: 'f1',
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(sessions.finalizeSession).toHaveBeenCalledTimes(1);
  });

  it('NEG-SESAPI-13: invalid model output is never stored', async () => {
    sessions.recentHistory.mockResolvedValue([{ role: 'user', text: 'Today was long.' }]);
    gemini.generateEntryDraft.mockRejectedValue(
      Object.assign(new Error('model output failed validation'), {
        statusCode: 502,
        code: 'AI_INVALID_OUTPUT',
        isOperational: true,
      })
    );

    const res = await call('/api/sessions/s1/finalize', {
      method: 'POST',
      uid: 'f2',
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(502);
    expect(sessions.finalizeSession).not.toHaveBeenCalled();
  });

  it('NEG-SESAPI-14: an already finalized session cannot be finalized twice', async () => {
    sessions.getSession.mockResolvedValue(session({ status: 'finalized', entryId: 'e1' }));
    sessions.recentHistory.mockResolvedValue([{ role: 'user', text: 'Today was long.' }]);

    const res = await call('/api/sessions/s1/finalize', {
      method: 'POST',
      uid: 'f3',
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(409);
    expect(gemini.generateEntryDraft).not.toHaveBeenCalled();
  });

  it('NEG-SESAPI-15: an empty conversation cannot be finalized into an entry', async () => {
    sessions.getSession.mockResolvedValue(session({ messageCount: 0 }));
    sessions.recentHistory.mockResolvedValue([]);

    const res = await call('/api/sessions/s1/finalize', {
      method: 'POST',
      uid: 'f4',
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(gemini.generateEntryDraft).not.toHaveBeenCalled();
  });
});

// --- cost as an availability threat --------------------------------------------------

describe('rate limiting', () => {
  it('NEG-SESAPI-16: a burst of model-backed calls is throttled with 429 and Retry-After', async () => {
    let throttled: Response | undefined;

    for (let i = 0; i < 15; i += 1) {
      const res = await call('/api/sessions/s1/messages', {
        method: 'POST',
        uid: 'burst-user',
        body: JSON.stringify({ text: `message ${i}` }),
      });
      if (res.status === 429) {
        throttled = res;
        break;
      }
    }

    expect(throttled, 'expected a 429 within 15 rapid model-backed calls').toBeTruthy();
    expect(throttled!.headers.get('Retry-After')).toBeTruthy();
  });
});
