import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import type { Server } from 'http';

describe('Security Headers & OAuth Popup Isolation (COOP / COEP)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
          },
        },
        crossOriginEmbedderPolicy: false,
        crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      })
    );

    app.get('/test-coop', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (typeof address === 'object' && address?.port) {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('SEC-COOP-01: cross-origin-opener-policy must be same-origin-allow-popups to prevent OAuth popup breakage', async () => {
    const res = await fetch(`${baseUrl}/test-coop`);
    expect(res.status).toBe(200);

    const coopHeader = res.headers.get('cross-origin-opener-policy');
    expect(coopHeader).toBe('same-origin-allow-popups');

    // COEP must not block cross-origin popup frames
    const coepHeader = res.headers.get('cross-origin-embedder-policy');
    expect(coepHeader).toBeNull();
  });
});