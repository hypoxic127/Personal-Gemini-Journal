import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { ensureUserDoc, getUserDoc } from '../services/users.js';

const router = express.Router();

const SyncUserSchema = z.object({
  displayName: z.string().max(100).optional(),
  photoURL: z.string().url().max(1000).optional().nullable(),
}).strict();

router.post('/sync', requireAuth, rateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = SyncUserSchema.safeParse(req.body || {});
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid user sync payload.',
          correlationId: (req.headers['x-correlation-id'] as string) || 'unknown',
        },
      });
      return;
    }

    const { displayName, photoURL } = parseResult.data;
    const profile = await ensureUserDoc({
      uid: req.user!.uid,
      email: req.user!.email,
      displayName: displayName || undefined,
      photoURL: photoURL !== undefined ? photoURL : undefined,
    });

    res.status(200).json({
      data: profile,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, rateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await getUserDoc(req.user!.uid);
    if (!profile) {
      // Auto-ensure if not found
      const created = await ensureUserDoc({
        uid: req.user!.uid,
        email: req.user!.email,
      });
      res.status(200).json({ data: created });
      return;
    }

    res.status(200).json({ data: profile });
  } catch (error) {
    next(error);
  }
});

export default router;