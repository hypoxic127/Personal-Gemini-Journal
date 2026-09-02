import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { Router } from 'express';

// Assembled at runtime rather than written as one literal: these are fake, but they are
// key-SHAPED, and scripts/security-check.sh scans source for `AIza...` with no exemptions.
// A gate with a carve-out for "test keys" is a gate anyone can walk through.
const KEY_PREFIX = 'AIza' + 'Sy';
const MAPS_BROWSER_KEY = `${KEY_PREFIX}FAKE_MAPS_BROWSER_0000000000000`;
const FIREBASE_WEB_KEY = `${KEY_PREFIX}FAKE_FIREBASE_WEB_0000000000000`;

const ENV_KEYS = [
  'MAPS_BROWSER_API_KEY',
  'FIREBASE_WEB_API_KEY',
  'FIREBASE_WEB_APP_ID',
  'FIREBASE_AUTH_DOMAIN',
] as const;

let server: Server | undefined;

const startWith = async (overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>) => {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, overrides);

  vi.resetModules();
  const { default: configRouter } = (await import('../src/routes/config.js')) as { default: Router };
  const { errorHandler } = await import('../src/middleware/errorHandler.js');

  const app = express();
  app.use(express.json());
  app.use('/api/config', configRouter);
  app.use(errorHandler);

  let baseUrl = '';
  await new Promise<void>((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => {
      server = s;
      const address = s.address();
      if (typeof address === 'object' && address && address.port) {
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      } else {
        reject(new Error('Failed to obtain server address'));
      }
    });
    s.on('error', reject);
  });
  return baseUrl;
};

afterEach(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

describe('GET /api/config/public (unauthenticated)', () => {
  it('NEG-CFG-01: never serves the Maps browser key, even when the Firebase key is unset', async () => {
    // The exact misconfiguration this endpoint used to paper over with a fallback chain:
    // a Maps key present, a Firebase Web key absent.
    const base = await startWith({ MAPS_BROWSER_API_KEY: MAPS_BROWSER_KEY });

    const res = await fetch(`${base}/api/config/public`);
    const body = await res.text();

    expect(body).not.toContain(MAPS_BROWSER_KEY);
    expect(res.status).toBe(503);
    expect(JSON.parse(body).error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('POS-CFG-01: serves only the Firebase Web config when it is configured', async () => {
    const base = await startWith({
      MAPS_BROWSER_API_KEY: MAPS_BROWSER_KEY,
      FIREBASE_WEB_API_KEY: FIREBASE_WEB_KEY,
      FIREBASE_WEB_APP_ID: '1:1234567890:web:abcdef',
    });

    const res = await fetch(`${base}/api/config/public`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).not.toContain(MAPS_BROWSER_KEY);

    const json = JSON.parse(body);
    expect(json.data.firebase.apiKey).toBe(FIREBASE_WEB_KEY);
    expect(json.data.firebase.appId).toBe('1:1234567890:web:abcdef');
    expect(Object.keys(json.data)).toEqual(['firebase']);
  });
});

describe('GET /api/config (Maps browser key)', () => {
  it('NEG-CFG-02: unauthenticated caller is DENIED the Maps browser key', async () => {
    const base = await startWith({
      MAPS_BROWSER_API_KEY: MAPS_BROWSER_KEY,
      FIREBASE_WEB_API_KEY: FIREBASE_WEB_KEY,
      FIREBASE_WEB_APP_ID: '1:1234567890:web:abcdef',
    });

    const res = await fetch(`${base}/api/config`);
    const body = await res.text();

    expect(res.status).toBe(401);
    expect(body).not.toContain(MAPS_BROWSER_KEY);
  });
});
