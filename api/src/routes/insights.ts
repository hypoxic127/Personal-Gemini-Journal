import express, { Request, Response, NextFunction } from 'express';
import { InsightQuerySchema } from '@journal/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
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
    const parsedQuery = InsightQuerySchema.safeParse(req.query);
    const range = parsedQuery.success ? parsedQuery.data.range : '30d';

    const uid = req.user!.uid;
    const insights = await getMoodInsights(uid, range);

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        correlationId: req.headers['x-correlation-id'] || 'internal',
        event: 'MOOD_INSIGHTS_ACCESSED',
        uid,
        range,
        totalEntries: insights.totalEntries,
      })
    );

    res.json({ data: insights });
  } catch (err) {
    next(err);
  }
});

export default router;