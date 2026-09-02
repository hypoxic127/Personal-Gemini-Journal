import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { env } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import configRouter from './routes/config.js';
import sessionsRouter from './routes/sessions.js';
import entriesRouter from './routes/entries.js';
import insightsRouter from './routes/insights.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();


// 1. Security Headers with Strict CSP
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://maps.googleapis.com',
          'https://apis.google.com',
          'https://*.firebaseapp.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        connectSrc: [
          "'self'",
          'https://*.googleapis.com',
          'https://*.firebaseio.com',
          'https://identitytoolkit.googleapis.com',
          'https://securetoken.googleapis.com',
        ],
        frameSrc: ['https://*.firebaseapp.com'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// 2. CORS - explicit allowlist for dev / same-origin in prod
if (env.NODE_ENV === 'development') {
  app.use(
    cors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
    })
  );
}

// 3. Body parsers with payload caps
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// 4. Liveness Probe (MUST NOT leak version or system details)
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

// 5. API Routes. /healthz is the only route that may skip requireAuth; every other
//    route mounts it (AGENTS.md §Identity and authorization 1). No unauthenticated debug
//    or echo endpoints — they are free reconnaissance and they rot into real surface.
const apiRouter = express.Router();

apiRouter.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

apiRouter.get('/ping', (_req: Request, res: Response) => {
  res.json({ data: { message: 'pong' } });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/config', configRouter);
apiRouter.use('/sessions', sessionsRouter);
apiRouter.use('/entries', entriesRouter);
apiRouter.use('/insights', insightsRouter);

app.use('/api', apiRouter);


// 6. Static Frontend Hosting & SPA Fallback
const webDistPath = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
} else {
  app.get('/', (_req: Request, res: Response) => {
    res.send('Personal Gemini Journal API is running. Build the frontend to view SPA.');
  });
}

// 7. Error Handler (MUST be last)
app.use(errorHandler);

// Start Server explicitly on 0.0.0.0
const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${env.PORT} (0.0.0.0) in ${env.NODE_ENV} mode`);
});


// Graceful Shutdown on SIGTERM / SIGINT
const gracefulShutdown = (signal: string) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed. Exiting process.');
    process.exit(0);
  });

  // Force close after 10s if connections linger
  setTimeout(() => {
    console.error('Forcefully terminating process after timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));