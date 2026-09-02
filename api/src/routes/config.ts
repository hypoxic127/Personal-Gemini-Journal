import express, { Request, Response, NextFunction } from 'express';
import { env } from '../config.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit, createRateLimiter } from '../middleware/rateLimit.js';
import { serviceUnavailable } from '../lib/errors.js';

const router = express.Router();

// This route is reachable before sign-in — the SPA cannot authenticate until it has the
// Firebase Web config. It is IP-keyed rather than uid-keyed for that reason.
const publicConfigRateLimit = createRateLimiter({ capacity: 20, refillRate: 0.5 });

/**
 * Firebase Web config, delivered at runtime so nothing is inlined at build time.
 *
 * What may appear here: the Firebase Web config only. It is a public identifier, not a
 * credential — it identifies the project to Google's auth endpoints and is protected by
 * Firestore Rules + App Check, not by concealment (AGENTS.md §Secret management 4).
 *
 * What may NEVER appear here: any billable or restricted key. The Maps browser key in
 * particular is served exclusively from the authenticated route below, per the Google Maps
 * directive ("delivered at runtime via GET /api/config to authenticated callers"). There is
 * deliberately no fallback chain into another env var: a fallback is how a restricted key
 * ends up on an unauthenticated endpoint wearing the wrong name, and how a misconfigured
 * referrer restriction stays invisible.
 */
router.get('/public', publicConfigRateLimit, (_req: Request, res: Response, next: NextFunction) => {
  const apiKey = env.FIREBASE_WEB_API_KEY;
  const appId = env.FIREBASE_WEB_APP_ID;

  // Fail closed and loudly rather than serving a half-built config the SPA would fail on
  // in a way that looks like an auth bug. In production these are required at startup, so
  // this branch is a development-time guard.
  if (!apiKey || !appId) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event: 'PUBLIC_CONFIG_INCOMPLETE',
        missing: [!apiKey && 'FIREBASE_WEB_API_KEY', !appId && 'FIREBASE_WEB_APP_ID'].filter(Boolean),
      })
    );
    next(serviceUnavailable('Application configuration is unavailable.'));
    return;
  }

  res.json({
    data: {
      firebase: {
        apiKey,
        authDomain: env.FIREBASE_AUTH_DOMAIN || `${env.GCP_PROJECT_ID}.firebaseapp.com`,
        projectId: env.GCP_PROJECT_ID,
        appId,
      },
    },
  });
});

// Maps browser key: restricted (HTTP referrer + API restriction + daily quota cap) AND
// delivered at runtime to authenticated callers only. Restriction is the real control;
// requiring a verified token here keeps it off an anonymous scrape.
router.get('/', requireAuth, rateLimit, (_req: Request, res: Response) => {
  res.json({
    data: {
      mapsBrowserApiKey: env.MAPS_BROWSER_API_KEY || null,
    },
  });
});

export default router;
