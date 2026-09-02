import express, { Request, Response } from 'express';
import { env } from '../config.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = express.Router();

// Public config served at runtime to frontend (avoids build-time inlining)
router.get('/public', (_req: Request, res: Response) => {
  res.json({
    data: {
      firebase: {
        apiKey: process.env.FIREBASE_WEB_API_KEY || process.env.MAPS_BROWSER_API_KEY || '',
        authDomain: `${env.GCP_PROJECT_ID}.firebaseapp.com`,
        projectId: env.GCP_PROJECT_ID,
        appId: process.env.FIREBASE_WEB_APP_ID || '',
      },
    },
  });
});

// Authenticated config for Maps Browser Key (runtime delivered, restricted by HTTP referrer + API)
router.get('/', requireAuth, rateLimit, (_req: Request, res: Response) => {
  res.json({
    data: {
      mapsBrowserApiKey: env.MAPS_BROWSER_API_KEY || null,
    },
  });
});

export default router;