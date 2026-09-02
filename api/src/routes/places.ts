import express, { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { ReverseGeocodeSchema } from '@journal/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { fromZodError } from '../lib/errors.js';
import * as placesService from '../services/places.js';
import * as sessionsService from '../services/sessions.js';

const router = express.Router();

const placesRateLimit = createRateLimiter({
  capacity: 15,
  refillRate: 0.5,
});

const correlationOf = (req: Request) =>
  (req.headers['x-correlation-id'] as string) || randomUUID();

const rawBody = (req: Request): Record<string, unknown> =>
  req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : {};

/**
 * POST /api/places/reverse-geocode
 * Resolves coordinate latitude and longitude to authoritative place name and standard geohash.
 * Recomputed server-side with strict parameter bounds to prevent location spoofing / poisoning.
 */
router.post(
  '/reverse-geocode',
  requireAuth,
  placesRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = correlationOf(req);
    try {
      const parsed = ReverseGeocodeSchema.safeParse(rawBody(req));
      if (!parsed.success) {
        next(fromZodError(parsed.error, 'Invalid coordinates for reverse geocoding.'));
        return;
      }

      const { lat, lng } = parsed.data;
      const result = await placesService.reverseGeocode(lat, lng, { correlationId });

      res.json({
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/places/clear-locations
 * Bulk removes location metadata from all past reflections and entries of the caller.
 * Creates an immutable audit trail entry in audit_logs.
 */
router.post(
  '/clear-locations',
  requireAuth,
  placesRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = correlationOf(req);
    try {
      const uid = req.user!.uid;
      const clearedCount = await sessionsService.clearUserLocations(uid);

      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          correlationId,
          event: 'USER_LOCATIONS_CLEARED',
          uid,
          clearedCount,
        })
      );

      res.json({
        data: {
          clearedCount,
          success: true,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
