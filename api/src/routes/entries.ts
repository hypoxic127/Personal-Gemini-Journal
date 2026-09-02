import express, { Request, Response, NextFunction } from 'express';
import { DocIdSchema, ListQuerySchema } from '@journal/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { badRequest, fromZodError, notFound } from '../lib/errors.js';
import * as sessions from '../services/sessions.js';

const router = express.Router();

/**
 * Saved entries. Read-only here: entries are written by the finalize route and by nothing
 * else, and every query is scoped to `req.user.uid` with a bounded page size.
 */

router.get('/', requireAuth, rateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      next(fromZodError(parsed.error, 'Invalid list options.'));
      return;
    }

    const page = await sessions.listEntries(req.user!.uid, parsed.data);
    res.json({ data: page });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', requireAuth, rateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsedId = DocIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      next(badRequest('Invalid entry id.'));
      return;
    }

    const entry = await sessions.getEntry(req.user!.uid, parsedId.data);
    if (!entry) {
      next(notFound('Entry not found.'));
      return;
    }

    res.json({ data: entry });
  } catch (error) {
    next(error);
  }
});

export default router;
