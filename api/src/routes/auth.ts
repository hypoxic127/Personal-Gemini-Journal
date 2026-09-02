import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { ensureUserDoc, getUserDoc } from '../services/users.js';
import { fromZodError } from '../lib/errors.js';
import type { UserProfile } from '../services/users.js';

const router = express.Router();

const SyncUserSchema = z.object({
  displayName: z.string().max(100).optional(),
  photoURL: z.string().url().max(1000).optional().nullable(),
}).strict();

/**
 * The Firestore `role` field is a display mirror and is never an authorization source.
 * To stop the two from drifting — a claim changed without the document being rewritten —
 * the API answers with the role from the *verified token*, which is the only one that
 * decides anything. The client then has a single source of truth for role, matching what
 * every server-side guard will use.
 */
const withVerifiedRole = (profile: UserProfile, role: 'user' | 'admin'): UserProfile => ({
  ...profile,
  role,
});

router.post('/sync', requireAuth, rateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = (req.body && typeof req.body === 'object') ? req.body : {};
    const parseResult = SyncUserSchema.safeParse(raw);
    if (!parseResult.success) {
      next(fromZodError(parseResult.error, 'Invalid user sync payload.'));
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
      data: withVerifiedRole(profile, req.user!.role),
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
      res.status(200).json({ data: withVerifiedRole(created, req.user!.role) });
      return;
    }

    res.status(200).json({ data: withVerifiedRole(profile, req.user!.role) });
  } catch (error) {
    next(error);
  }
});

export default router;
