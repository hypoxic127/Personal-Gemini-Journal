import express, { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import {
  CreateMessageSchema,
  CreateSessionSchema,
  DocIdSchema,
  FinalizeSessionSchema,
  ListQuerySchema,
  MAX_HISTORY_TURNS,
  type LocationData,
} from '@journal/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit, aiRateLimit } from '../middleware/rateLimit.js';
import { badRequest, conflict, fromZodError, notFound, AppError } from '../lib/errors.js';
import * as sessions from '../services/sessions.js';
import * as gemini from '../services/gemini.js';
import * as placesService from '../services/places.js';

const router = express.Router();

/**
 * Everything below keys on `req.user.uid` from the verified token. A session id in the path
 * is a document id, never an identity: it is resolved inside the caller's own subtree, so
 * another user's id simply does not exist here and 404s.
 */

const correlationOf = (req: Request) =>
  (req.headers['x-correlation-id'] as string) || randomUUID();

/** Null-safe ingestion: a missing or non-object body is a clean 400, never a destructure throw. */
const rawBody = (req: Request): Record<string, unknown> =>
  req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : {};

// `unknown` on purpose: Express hands back `string | string[]`, and a repeated path
// parameter must be rejected rather than coerced into something that looks like an id.
const parseDocId = (value: unknown, label: string): string => {
  const parsed = DocIdSchema.safeParse(value);
  if (!parsed.success) throw badRequest(`Invalid ${label}.`);
  return parsed.data;
};

const parseListQuery = (req: Request) => {
  const parsed = ListQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) throw fromZodError(parsed.error, 'Invalid list options.');
  return parsed.data;
};

/**
 * A write that fails must say so. The alternative — a reply on screen that is gone after a
 * refresh — is the single worst outcome for a journal, so persistence failures become an
 * explicit 503 the UI can offer a retry for.
 */
const saveFailed = (err: unknown, context: Record<string, unknown>): AppError => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'PERSISTENCE_FAILED',
      ...context,
      errorMessage: err instanceof Error ? err.message : 'unknown',
    })
  );
  return new AppError(
    503,
    'SAVE_FAILED',
    'Your message could not be saved. Nothing has been lost — please retry.'
  );
};

const loadActiveSession = async (uid: string, sessionId: string) => {
  const session = await sessions.getSession(uid, sessionId);
  if (!session) throw notFound('Reflection not found.');
  return session;
};

// --------------------------------------------------------------------------------------
// POST /api/sessions — start a reflection, optionally with the first message
// --------------------------------------------------------------------------------------

router.post('/', requireAuth, aiRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = correlationOf(req);
  try {
    const parsed = CreateSessionSchema.safeParse(rawBody(req));
    if (!parsed.success) {
      next(fromZodError(parsed.error, 'Invalid session payload.'));
      return;
    }

    const uid = req.user!.uid;
    const { initialMessage } = parsed.data;

    let session;
    try {
      session = await sessions.createSession(uid, initialMessage);
    } catch (err) {
      next(saveFailed(err, { correlationId, uid, step: 'createSession' }));
      return;
    }

    if (!initialMessage) {
      res.status(201).json({ data: { session } });
      return;
    }

    const turn = await runTurn({
      uid,
      sessionId: session.id,
      text: initialMessage,
      correlationId,
    });

    res.status(201).json({ data: { session, ...turn } });
  } catch (error) {
    next(error);
  }
});

// --------------------------------------------------------------------------------------
// GET /api/sessions, GET /api/sessions/:id, DELETE /api/sessions/:id
// --------------------------------------------------------------------------------------

router.get('/', requireAuth, rateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = await sessions.listSessions(req.user!.uid, parseListQuery(req));
    res.json({ data: page });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', requireAuth, rateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = parseDocId(req.params.id, 'reflection id');
    const session = await sessions.getSession(req.user!.uid, sessionId);
    if (!session) {
      next(notFound('Reflection not found.'));
      return;
    }
    res.json({ data: session });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', requireAuth, rateLimit, async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = correlationOf(req);
  try {
    const sessionId = parseDocId(req.params.id, 'reflection id');
    const uid = req.user!.uid;

    const session = await sessions.getSession(uid, sessionId);
    if (!session) {
      next(notFound('Reflection not found.'));
      return;
    }

    try {
      await sessions.deleteSession(uid, sessionId);
    } catch (err) {
      next(saveFailed(err, { correlationId, uid, sessionId, step: 'deleteSession' }));
      return;
    }

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        correlationId,
        event: 'SESSION_DELETED',
        uid,
        sessionId,
      })
    );

    res.json({ data: { id: sessionId, deleted: true } });
  } catch (error) {
    next(error);
  }
});

// --------------------------------------------------------------------------------------
// Messages
// --------------------------------------------------------------------------------------

router.get('/:id/messages', requireAuth, rateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = parseDocId(req.params.id, 'reflection id');
    const uid = req.user!.uid;

    await loadActiveSession(uid, sessionId);
    const page = await sessions.listMessages(uid, sessionId, parseListQuery(req));
    res.json({ data: page });
  } catch (error) {
    next(error);
  }
});

/**
 * One conversational turn:
 *   1. persist the user's words FIRST — before the model is called, so an AI outage can
 *      never cost someone what they wrote;
 *   2. load a capped slice of history;
 *   3. generate;
 *   4. persist the reply, and report a failure at that step rather than returning success.
 */
async function runTurn(args: {
  uid: string;
  sessionId: string;
  text: string;
  correlationId: string;
  titleFromText?: boolean;
}) {
  const { uid, sessionId, text, correlationId } = args;

  let userMessage;
  try {
    userMessage = await sessions.appendUserMessage(uid, sessionId, text, {
      titleFromText: args.titleFromText ?? false,
    });
  } catch (err) {
    throw saveFailed(err, { correlationId, uid, sessionId, step: 'appendUserMessage' });
  }

  const history = await sessions.recentHistory(uid, sessionId, MAX_HISTORY_TURNS);
  // The turn just written is passed separately as the current message.
  const priorHistory = history.slice(0, -1);

  const reply = await gemini.generateChatReply({
    history: priorHistory,
    userText: text,
    correlationId,
  });

  let modelMessage;
  try {
    modelMessage = await sessions.appendModelMessage(uid, sessionId, reply.text, reply.model);
  } catch (err) {
    throw saveFailed(err, { correlationId, uid, sessionId, step: 'appendModelMessage' });
  }

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      correlationId,
      event: 'TURN_COMPLETED',
      uid,
      sessionId,
      model: reply.model,
      // Lengths only. The conversation itself never reaches a log line.
      userTextLength: text.length,
      replyLength: reply.text.length,
      historyTurns: priorHistory.length,
    })
  );

  return { userMessage, modelMessage, model: reply.model };
}

router.post(
  '/:id/messages',
  requireAuth,
  aiRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = correlationOf(req);
    try {
      const sessionId = parseDocId(req.params.id, 'reflection id');
      const parsed = CreateMessageSchema.safeParse(rawBody(req));
      if (!parsed.success) {
        next(fromZodError(parsed.error, 'Invalid message payload.'));
        return;
      }

      const uid = req.user!.uid;
      const session = await loadActiveSession(uid, sessionId);
      if (session.status === 'finalized') {
        next(conflict('This reflection has been saved and is no longer open.'));
        return;
      }

      // parsed.data.text is already truncated to the server limit by the shared schema.
      const turn = await runTurn({
        uid,
        sessionId,
        text: parsed.data.text,
        correlationId,
        titleFromText: session.messageCount === 0,
      });
      res.json({ data: turn });
    } catch (error) {
      next(error);
    }
  }
);

// --------------------------------------------------------------------------------------
// POST /api/sessions/:id/finalize — conversation → structured entry
// --------------------------------------------------------------------------------------

router.post(
  '/:id/finalize',
  requireAuth,
  aiRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = correlationOf(req);
    try {
      const sessionId = parseDocId(req.params.id, 'reflection id');
      const parsed = FinalizeSessionSchema.safeParse(rawBody(req));
      if (!parsed.success) {
        next(fromZodError(parsed.error, 'Invalid finalize payload.'));
        return;
      }

      const uid = req.user!.uid;
      const session = await loadActiveSession(uid, sessionId);
      if (session.status === 'finalized') {
        next(conflict('This reflection has already been saved.'));
        return;
      }

      const turns = await sessions.recentHistory(uid, sessionId, MAX_HISTORY_TURNS);
      if (turns.length === 0) {
        next(badRequest('There is nothing to summarise yet — write something first.'));
        return;
      }

      // Throws AI_INVALID_OUTPUT before this line if the model's JSON fails Zod, so an
      // unvalidated draft has no path to Firestore.
      const { draft, model } = await gemini.generateEntryDraft({ turns, correlationId });

      let locationData: LocationData | null = null;
      if (parsed.data.location) {
        locationData = await placesService.resolveLocation(
          parsed.data.location.lat,
          parsed.data.location.lng,
          { correlationId }
        );
      }

      let entry;
      try {
        entry = await sessions.finalizeSession(uid, sessionId, draft, model, locationData);
      } catch (err) {
        if (err instanceof AppError) throw err; // 404 / 409 raised inside the transaction
        throw saveFailed(err, { correlationId, uid, sessionId, step: 'finalizeSession' });
      }

      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          correlationId,
          event: 'SESSION_FINALIZED',
          uid,
          sessionId,
          entryId: entry.id,
          model,
          mood: entry.mood,
          summaryLength: entry.summary.length,
        })
      );

      res.json({ data: entry });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
