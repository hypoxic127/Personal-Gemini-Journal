import { randomUUID } from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import {
  SetUserRoleSchema,
  AdminUsersQuerySchema,
  DocIdSchema,
} from '@journal/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { auth } from '../firebase.js';
import { logAuditEvent } from '../services/audit.js';
import * as aggregatesService from '../services/aggregates.js';
import * as usersService from '../services/users.js';
import { AppError, badRequest, fromZodError } from '../lib/errors.js';

const router = Router();

// Guard all admin routes with requireAuth and requireAdmin server-side guards + rate limiting
router.use(requireAuth);
router.use(requireAdmin);
router.use(rateLimit);

const rawBody = (req: Request): Record<string, unknown> =>
  req.body && typeof req.body === 'object' ? req.body : {};

// --------------------------------------------------------------------------------------
// GET /api/admin/stats — De-identified Population Insights
// --------------------------------------------------------------------------------------
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actorUid = req.user!.uid;

    const stats = await aggregatesService.getAdminStats();

    const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        correlationId,
        event: 'admin.stats.view',
        actorUid,
        totalEntries: stats.totalEntries,
        activeUsers: stats.activeUsers,
        suppressed: stats.suppressed,
      })
    );

    res.json({ data: stats });
  } catch (error) {
    next(error);
  }
});

// --------------------------------------------------------------------------------------
// GET /api/admin/users — Paginated User Metadata (Strict Zero-Content Guarantee)
// --------------------------------------------------------------------------------------
router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actorUid = req.user!.uid;
    const parsedQuery = AdminUsersQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      next(fromZodError(parsedQuery.error, 'Invalid query parameters.'));
      return;
    }

    const { limit, cursor } = parsedQuery.data;

    const result = await usersService.listUsers({ limit, cursor });

    await logAuditEvent({
      actorUid,
      action: 'admin.users.list',
      targetUid: actorUid,
      meta: {
        limit,
        cursor: cursor ?? null,
        resultCount: result.items.length,
      },
    });

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// --------------------------------------------------------------------------------------
// POST /api/admin/users/:uid/role — Role Mutation with Safe Fail-Closed Execution Order
// --------------------------------------------------------------------------------------
router.post('/users/:uid/role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actorUid = req.user!.uid;
    const paramParsed = DocIdSchema.safeParse(req.params.uid);
    if (!paramParsed.success) {
      next(badRequest('Invalid user id format.'));
      return;
    }

    const targetUid = paramParsed.data;

    const bodyParsed = SetUserRoleSchema.safeParse(rawBody(req));
    if (!bodyParsed.success) {
      next(fromZodError(bodyParsed.error, 'Invalid role payload.'));
      return;
    }

    const { role } = bodyParsed.data;

    // Anti-self-demotion: Prevent the active admin from locking themselves out
    if (targetUid === actorUid && role !== 'admin') {
      throw new AppError(
        400,
        'CANNOT_DEMOTE_SELF',
        'Administrators cannot demote their own account.'
      );
    }

    // 1. Write Firestore display mirror first (fail-closed: aborts before custom claims change if write fails)
    await usersService.updateUserRole(targetUid, role);

    // 2. Set Custom User Claims in Firebase Auth
    await auth.setCustomUserClaims(targetUid, { role });

    // 3. Immediately revoke refresh tokens for the target user (prevent stale token window)
    await auth.revokeRefreshTokens(targetUid);

    // 4. Record immutable audit log entry
    const action = role === 'admin' ? 'role.grant' : 'role.revoke';
    await logAuditEvent({
      actorUid,
      action,
      targetUid,
      meta: { role },
    });

    res.json({
      data: {
        ok: true,
        uid: targetUid,
        role,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
export { router as adminRouter };
