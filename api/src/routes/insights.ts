import { randomUUID } from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import { InsightQuerySchema, MoodInsightResponseSchema } from '@journal/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { fromZodError } from '../lib/errors.js';
import { getMoodInsights } from '../services/insights.js';

const router = express.Router();

router.use(requireAuth);
router.use(rateLimit);

/**
 * GET /api/insights/mood?range=7d|30d|90d
 *
 * Computes aggregated mood trajectory, mood distribution, top tags, and explainability
 * reasons strictly for the authenticated caller.
 */
router.get('/mood', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = (req.query && typeof req.query === 'object') ? req.query : {};
    const parsedQuery = InsightQuerySchema.safeParse(raw);
    if (!parsedQuery.success) {
      next(fromZodError(parsedQuery.error, 'Invalid insight query options.'));
      return;
    }
    const range = parsedQuery.data.range;

    const uid = req.user!.uid;
    const insights = await getMoodInsights(uid, range);
    const validated = MoodInsightResponseSchema.parse(insights);

    const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        correlationId,
        event: 'MOOD_INSIGHTS_ACCESSED',
        uid,
        range,
        totalEntries: validated.totalEntries,
      })
    );

    res.json({ data: validated });
  } catch (err) {
    next(err);
  }
});

export default router;