import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

// Mock Firebase
vi.mock('../src/firebase.js', () => ({
  auth: {
    verifyIdToken: vi.fn(async (token: string) => {
      if (token === 'token_user_alice') {
        return { uid: 'user_alice', email: 'alice@example.com', role: 'user' };
      }
      if (token === 'token_user_bob') {
        return { uid: 'user_bob', email: 'bob@example.com', role: 'user' };
      }
      throw new Error('Invalid token');
    }),
  },
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        set: vi.fn(async () => {}),
        get: vi.fn(async () => ({ exists: false })),
      })),
      get: vi.fn(async () => ({ empty: true, docs: [] })),
    })),
    batch: vi.fn(() => ({
      update: vi.fn(),
      commit: vi.fn(async () => {}),
    })),
  },
  FieldValue: { serverTimestamp: () => 'SENTINEL', increment: (n: number) => ({ inc: n }) },
  Timestamp: {
    fromDate: (d: Date) => ({ toDate: () => d }),
  },
}));

// Mock sessions service
const mockSessionsService = {
  clearUserLocations: vi.fn(async (uid: string) => {
    return uid === 'user_alice' ? 3 : 0;
  }),
};
vi.mock('../src/services/sessions.js', () => mockSessionsService);

const { default: placesRouter } = await import('../src/routes/places.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

describe('Places Routes (M4 Reverse Geocode & Location Privacy Triad API)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '256kb' }));
    app.use('/api/places', placesRouter);
    app.use(errorHandler);

    const listening = app.listen(0);
    await new Promise<void>((resolve) => listening.once('listening', () => resolve()));
    server = listening;
    const addr = listening.address() as { port: number };
    baseUrl = 'http://127.0.0.1:' + addr.port;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('POST /api/places/reverse-geocode', () => {
    it('NEG-PLC-01: unauthenticated request returns 401 UNAUTHORIZED', async () => {
      const res = await fetch(baseUrl + '/api/places/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 37.7749, lng: -122.4194 }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error?.code).toBe('UNAUTHORIZED');
    });

    it('NEG-PLC-02: invalid token returns 401 UNAUTHORIZED', async () => {
      const res = await fetch(baseUrl + '/api/places/reverse-geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid_token_xyz',
        },
        body: JSON.stringify({ lat: 37.7749, lng: -122.4194 }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error?.code).toBe('UNAUTHORIZED');
    });

    it('NEG-PLC-03: out-of-bounds latitude returns 400 BAD_REQUEST', async () => {
      const res = await fetch(baseUrl + '/api/places/reverse-geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_user_alice',
        },
        body: JSON.stringify({ lat: 95.0, lng: -122.4194 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error?.code).toBe('BAD_REQUEST');
    });

    it('NEG-PLC-04: out-of-bounds longitude returns 400 BAD_REQUEST', async () => {
      const res = await fetch(baseUrl + '/api/places/reverse-geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_user_alice',
        },
        body: JSON.stringify({ lat: 37.7749, lng: 185.0 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error?.code).toBe('BAD_REQUEST');
    });

    it('NEG-PLC-05: non-numeric / NaN coordinates return 400 BAD_REQUEST', async () => {
      const res = await fetch(baseUrl + '/api/places/reverse-geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_user_alice',
        },
        body: JSON.stringify({ lat: 'not_a_number', lng: -122.4194 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error?.code).toBe('BAD_REQUEST');
    });

    it('NEG-PLC-06: extra unexpected fields are rejected with 400 (strict schema anti-poisoning)', async () => {
      const res = await fetch(baseUrl + '/api/places/reverse-geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_user_alice',
        },
        body: JSON.stringify({
          lat: 37.7749,
          lng: -122.4194,
          placeName: 'Forged Location',
          geohash: 'poisoned',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error?.code).toBe('BAD_REQUEST');
    });

    it('POS-PLC-01: valid coordinates return 200 with resolved place and geohash', async () => {
      const res = await fetch(baseUrl + '/api/places/reverse-geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_user_alice',
        },
        body: JSON.stringify({ lat: 37.7749, lng: -122.4194 }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.data.lat).toBe(37.7749);
      expect(body.data.lng).toBe(-122.4194);
      expect(body.data.geohash).toBe('9q8yyk');
      expect(body.data.placeName).toBe('37.77°, -122.42°');
    });
  });

  describe('POST /api/places/clear-locations', () => {
    it('NEG-PLC-08: unauthenticated request to clear-locations returns 401 UNAUTHORIZED', async () => {
      const res = await fetch(baseUrl + '/api/places/clear-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error?.code).toBe('UNAUTHORIZED');
    });

    it('POS-PLC-03: authenticated request clears locations and returns count', async () => {
      const res = await fetch(baseUrl + '/api/places/clear-locations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_user_alice',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual({
        clearedCount: 3,
        success: true,
      });

      // Verify that clearUserLocations was called with verified token UID ('user_alice')
      expect(mockSessionsService.clearUserLocations).toHaveBeenCalledWith('user_alice');
    });

    it('ISO-PLC-01: spoofed x-user-id header is ignored and tenant isolation is enforced', async () => {
      const res = await fetch(baseUrl + '/api/places/clear-locations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_user_alice',
          'x-user-id': 'victim_user_bob',
        },
      });

      expect(res.status).toBe(200);
      expect(mockSessionsService.clearUserLocations).toHaveBeenCalledWith('user_alice');
      expect(mockSessionsService.clearUserLocations).not.toHaveBeenCalledWith('victim_user_bob');
    });
  });
});
