import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express, { type Request, type Response } from 'express';
import type { Server } from 'http';
import { Timestamp } from 'firebase-admin/firestore';
import {
  ReverseGeocodeSchema,
  FinalizeSessionSchema,
  LocationSchema,
  type LocationData,
} from '@journal/shared';
import {
  validateCoordinates,
  degradePrecision,
  encodeGeohash,
  reverseGeocode,
  resolveLocation,
} from '../src/services/places.js';

// ============================================================================
// Multi-Tenant In-Memory Mock Firestore for Empirical Verification
// ============================================================================

interface MockDoc {
  id: string;
  data: Record<string, any>;
}

// In-memory collections keyed by path
const mockStore: Record<string, MockDoc[]> = {};
const mockAuditLogs: Array<Record<string, any>> = [];

function getCollectionDocs(path: string): MockDoc[] {
  if (!mockStore[path]) {
    mockStore[path] = [];
  }
  return mockStore[path];
}

vi.mock('../src/firebase.js', () => ({
  auth: {
    verifyIdToken: vi.fn(async (token: string) => {
      if (token && token.startsWith('token_')) {
        const uid = token.replace('token_', 'user_');
        return { uid, email: `${uid}@example.com`, role: 'user' };
      }
      throw new Error('Invalid token');
    }),
  },
  db: {
    collection: (colPath: string) => {
      if (colPath === 'audit_logs') {
        return {
          doc: () => ({
            id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            set: async (data: any) => {
              mockAuditLogs.push(data);
            },
          }),
        };
      }

      return {
        doc: (docId?: string) => {
          const id = docId || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          return {
            id,
            get: async () => {
              const docs = getCollectionDocs(colPath);
              const found = docs.find((d) => d.id === id);
              return {
                exists: !!found,
                id,
                data: () => (found ? { ...found.data } : undefined),
              };
            },
            set: async (data: any) => {
              const docs = getCollectionDocs(colPath);
              const existingIdx = docs.findIndex((d) => d.id === id);
              if (existingIdx >= 0) {
                docs[existingIdx].data = { ...data };
              } else {
                docs.push({ id, data: { ...data } });
              }
            },
            update: async (data: any) => {
              const docs = getCollectionDocs(colPath);
              const existing = docs.find((d) => d.id === id);
              if (existing) {
                existing.data = { ...existing.data, ...data };
              }
            },
            delete: async () => {
              const docs = getCollectionDocs(colPath);
              const idx = docs.findIndex((d) => d.id === id);
              if (idx >= 0) docs.splice(idx, 1);
            },
          };
        },
        get: async () => {
          const docs = getCollectionDocs(colPath);
          return {
            empty: docs.length === 0,
            size: docs.length,
            docs: docs.map((d) => ({
              id: d.id,
              ref: {
                update: async (data: any) => {
                  d.data = { ...d.data, ...data };
                },
                delete: async () => {
                  const idx = docs.findIndex((x) => x.id === d.id);
                  if (idx >= 0) docs.splice(idx, 1);
                },
              },
              data: () => ({ ...d.data }),
            })),
          };
        },
      };
    },
    doc: (docPath: string) => {
      const parts = docPath.split('/');
      const colPath = parts.slice(0, -1).join('/');
      const docId = parts[parts.length - 1];
      const docs = getCollectionDocs(colPath);
      return {
        id: docId,
        get: async () => {
          const found = docs.find((d) => d.id === docId);
          return {
            exists: !!found,
            id: docId,
            data: () => (found ? { ...found.data } : undefined),
          };
        },
        set: async (data: any, options?: { merge?: boolean }) => {
          const existing = docs.find((d) => d.id === docId);
          if (existing && options?.merge) {
            existing.data = { ...existing.data, ...data };
          } else if (existing) {
            existing.data = { ...data };
          } else {
            docs.push({ id: docId, data: { ...data } });
          }
        },
        update: async (data: any) => {
          const existing = docs.find((d) => d.id === docId);
          if (existing) {
            existing.data = { ...existing.data, ...data };
          }
        },
      };
    },
    batch: () => {
      const operations: Array<() => Promise<void>> = [];
      return {
        update: (ref: any, data: any) => {
          operations.push(() => ref.update(data));
        },
        delete: (ref: any) => {
          operations.push(() => ref.delete());
        },
        set: (ref: any, data: any) => {
          operations.push(() => ref.set(data));
        },
        commit: async () => {
          for (const op of operations) {
            await op();
          }
        },
      };
    },
    runTransaction: async (updateFunction: (tx: any) => Promise<any>) => {
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: any, options?: any) => ref.set(data, options),
        update: (ref: any, data: any) => ref.update(data),
        delete: (ref: any) => ref.delete(),
      };
      return updateFunction(tx);
    },
  },
  FieldValue: {
    serverTimestamp: () => 'SERVER_TIMESTAMP_SENTINEL',
    increment: (n: number) => ({ __increment: n }),
  },
  Timestamp: {
    fromDate: (d: Date) => ({ toDate: () => d }),
  },
}));

const { default: placesRouter } = await import('../src/routes/places.js');
const { clearUserLocations } = await import('../src/services/sessions.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

describe('Empirical Adversarial Challenge Suite: Milestone 4 (Geospatial & Maps)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '256kb' }));
    app.use('/api/places', placesRouter);
    app.use(errorHandler);

    await new Promise<void>((resolve, reject) => {
      const s = app.listen(0, '127.0.0.1', () => {
        server = s;
        const addr = s.address();
        if (typeof addr === 'object' && addr && addr.port) {
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        } else {
          reject(new Error('Failed to obtain server address'));
        }
      });
      s.on('error', reject);
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    for (const key of Object.keys(mockStore)) {
      delete mockStore[key];
    }
    mockAuditLogs.length = 0;
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Extreme Coordinate Boundary Stress-Testing
  // =========================================================================
  describe('1. Extreme Coordinate Bounds and Fuzzing', () => {
    const boundaryValidCases = [
      { name: 'North-East maximum (90, 180)', lat: 90, lng: 180 },
      { name: 'South-West minimum (-90, -180)', lat: -90, lng: -180 },
      { name: 'North-West corner (90, -180)', lat: 90, lng: -180 },
      { name: 'South-East corner (-90, 180)', lat: -90, lng: 180 },
      { name: 'Null Island origin (0, 0)', lat: 0, lng: 0 },
      { name: 'Equator east (0, 180)', lat: 0, lng: 180 },
      { name: 'Equator west (0, -180)', lat: 0, lng: -180 },
      { name: 'North pole prime meridian (90, 0)', lat: 90, lng: 0 },
      { name: 'South pole prime meridian (-90, 0)', lat: -90, lng: 0 },
    ];

    for (let i = 0; i < boundaryValidCases.length; i++) {
      const testCase = boundaryValidCases[i];
      it(`ADV-GEO-01 [${testCase.name}]: accepted with 200 and correct Base32 geohash`, async () => {
        expect(validateCoordinates(testCase.lat, testCase.lng)).toBe(true);

        const res = await fetch(`${baseUrl}/api/places/reverse-geocode`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer token_valid_geo_${i}`,
          },
          body: JSON.stringify({ lat: testCase.lat, lng: testCase.lng }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data).toBeDefined();
        expect(body.data.lat).toBe(testCase.lat);
        expect(body.data.lng).toBe(testCase.lng);
        expect(typeof body.data.geohash).toBe('string');
        expect(body.data.geohash.length).toBe(6);
        expect(/^[0123456789bcdefghjkmnpqrstuvwxyz]+$/.test(body.data.geohash)).toBe(true);
      });
    }

    const invalidBoundaryCases = [
      { name: 'Latitude just above maximum (90.0001, 0)', raw: '{"lat": 90.0001, "lng": 0}' },
      { name: 'Latitude just below minimum (-90.0001, 0)', raw: '{"lat": -90.0001, "lng": 0}' },
      { name: 'Longitude just above maximum (0, 180.0001)', raw: '{"lat": 0, "lng": 180.0001}' },
      { name: 'Longitude just below minimum (0, -180.0001)', raw: '{"lat": 0, "lng": -180.0001}' },
      { name: 'Latitude massive positive float (1e20, 0)', raw: '{"lat": 1e20, "lng": 0}' },
      { name: 'Latitude massive negative float (-1e20, 0)', raw: '{"lat": -1e20, "lng": 0}' },
      { name: 'Longitude massive positive float (0, 1e20)', raw: '{"lat": 0, "lng": 1e20}' },
      { name: 'Longitude massive negative float (0, -1e20)', raw: '{"lat": 0, "lng": -1e20}' },
      { name: 'NaN latitude', raw: '{"lat": "NaN", "lng": 0}' },
      { name: 'Infinity latitude', raw: '{"lat": "Infinity", "lng": 0}' },
      { name: 'String latitude ("37.77", 0)', raw: '{"lat": "37.77", "lng": 0}' },
      { name: 'String longitude (0, "-122.41")', raw: '{"lat": 0, "lng": "-122.41"}' },
      { name: 'Null coordinates (null, null)', raw: '{"lat": null, "lng": null}' },
      { name: 'Undefined latitude', raw: '{"lng": 0}' },
      { name: 'Empty payload object', raw: '{}' },
      { name: 'Boolean coordinates', raw: '{"lat": true, "lng": false}' },
      { name: 'Array coordinates', raw: '{"lat": [37.77], "lng": [-122.41]}' },
      { name: 'Nested object coordinates', raw: '{"lat": {"value": 37.77}, "lng": 0}' },
    ];

    for (let i = 0; i < invalidBoundaryCases.length; i++) {
      const testCase = invalidBoundaryCases[i];
      it(`ADV-GEO-02 [${testCase.name}]: strictly rejected with HTTP 400 BAD_REQUEST`, async () => {
        const res = await fetch(`${baseUrl}/api/places/reverse-geocode`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer token_invalid_geo_${i}`,
          },
          body: testCase.raw,
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBeDefined();
        expect(body.error.code).toBe('BAD_REQUEST');
      });
    }

    it('ADV-GEO-03: precision degradation eliminates negative zero (-0) for sub-decimal zeroes', () => {
      const degradedNegLat = degradePrecision(-0.000001, 0.000001);
      expect(degradedNegLat.lat).toBe(0);
      expect(degradedNegLat.lng).toBe(0);
      expect(Object.is(degradedNegLat.lat, 0)).toBe(true);
      expect(Object.is(degradedNegLat.lat, -0)).toBe(false);
      expect(Object.is(degradedNegLat.lng, 0)).toBe(true);
      expect(Object.is(degradedNegLat.lng, -0)).toBe(false);

      const degradedBoundary = degradePrecision(-89.99999, 179.99999);
      expect(degradedBoundary.lat).toBe(-90);
      expect(degradedBoundary.lng).toBe(180);
    });
  });

  // =========================================================================
  // 2. Anti-Poisoning & Strict Schema Enforcement
  // =========================================================================
  describe('2. Anti-Poisoning & Strict Schema Parameter Injection', () => {
    const poisoningPayloads = [
      {
        name: 'forged placeName injection',
        raw: '{"lat": 37.77, "lng": -122.42, "placeName": "Forged City"}',
      },
      {
        name: 'forged geohash injection',
        raw: '{"lat": 37.77, "lng": -122.42, "geohash": "badhash"}',
      },
      {
        name: 'privilege escalation actorUid injection',
        raw: '{"lat": 37.77, "lng": -122.42, "actorUid": "admin_master"}',
      },
      {
        name: 'privilege escalation role injection',
        raw: '{"lat": 37.77, "lng": -122.42, "role": "admin"}',
      },
      {
        name: 'prototype pollution injection attempt in JSON',
        raw: '{"lat": 37.77, "lng": -122.42, "__proto__": {"isAdmin": true}}',
      },
      {
        name: 'constructor property injection',
        raw: '{"lat": 37.77, "lng": -122.42, "constructor": "malicious"}',
      },
      {
        name: 'script tag XSS in place name',
        raw: '{"lat": 37.77, "lng": -122.42, "placeName": "<script>alert(1)</script>"}',
      },
      {
        name: 'arbitrary extra metadata field',
        raw: '{"lat": 37.77, "lng": -122.42, "extraField": "should_fail"}',
      },
    ];

    for (let i = 0; i < poisoningPayloads.length; i++) {
      const testCase = poisoningPayloads[i];
      it(`ADV-POIS-01 [${testCase.name}]: rejected by strict Zod schema with HTTP 400`, async () => {
        const res = await fetch(`${baseUrl}/api/places/reverse-geocode`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer token_pois_${i}`,
          },
          body: testCase.raw,
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error?.code).toBe('BAD_REQUEST');
      });
    }

    it('ADV-POIS-02: placesService.resolveLocation ignores external placeName and computes authoritative value server-side', async () => {
      const resolved = await resolveLocation(37.7749, -122.4194, {
        degrade: true,
        source: 'gps',
      });

      expect(resolved.lat).toBe(37.77);
      expect(resolved.lng).toBe(-122.42);
      expect(resolved.geohash).toBe('9q8yy7');
      // Place name is generated server-side, not user-controllable
      expect(resolved.placeName).toBe('37.77°, -122.42°');
      expect(resolved.source).toBe('gps');
    });

    it('ADV-POIS-03: FinalizeSessionSchema strictly rejects forged placeName/geohash via .strict() validation', () => {
      const parsedForged = FinalizeSessionSchema.safeParse({
        location: {
          lat: 37.77,
          lng: -122.42,
          placeName: 'Attacker Place',
          geohash: 'poisonhash',
        },
      });

      // Strict Zod schema rejects undeclared server fields with validation failure
      expect(parsedForged.success).toBe(false);

      const parsedValid = FinalizeSessionSchema.safeParse({
        location: {
          lat: 37.77,
          lng: -122.42,
        },
      });
      expect(parsedValid.success).toBe(true);
      if (parsedValid.success) {
        expect(parsedValid.data.location).toEqual({ lat: 37.77, lng: -122.42, source: 'gps' });
      }
    });

    it('ADV-POIS-04: FinalizeSessionSchema accepts null location safely without rejecting with 400', () => {
      const parsedNull = FinalizeSessionSchema.safeParse({ location: null });
      expect(parsedNull.success).toBe(true);
      if (parsedNull.success) {
        expect(parsedNull.data.location).toBeNull();
      }

      const parsedEmpty = FinalizeSessionSchema.safeParse({});
      expect(parsedEmpty.success).toBe(true);
      if (parsedEmpty.success) {
        expect(parsedEmpty.data.location).toBeUndefined();
      }
    });

    it('ADV-GEO-04: resolveLocation enforces server-side precision degradation by default (~1.1 km)', async () => {
      // High-precision GPS coordinates passed without options must be degraded server-side
      const resolved = await resolveLocation(37.7749294821, -122.4194162819);
      expect(resolved.lat).toBe(37.77);
      expect(resolved.lng).toBe(-122.42);
      expect(resolved.geohash).toBe('9q8yy7');
    });

    it('ADV-GEO-05: reverseGeocode normalizes -0.00 sub-decimal zeroes in fallback place label', async () => {
      const result = await reverseGeocode(-0.001, -0.002);
      expect(result.placeName).toBe('0.00°, 0.00°');
    });
  });

  // =========================================================================
  // 3. Multi-Tenant Isolation on Bulk Clear (POST /api/places/clear-locations)
  // =========================================================================
  describe('3. Multi-Tenant Isolation on Bulk Clear', () => {
    it('ADV-ISO-01: User Alice clearing locations removes only Alice entries and leaves Bob entries completely intact', async () => {
      // Seed Alice entries: 2 with location, 1 without
      const aliceEntries = getCollectionDocs('users/user_alice/entries');
      aliceEntries.push(
        {
          id: 'alice_entry_1',
          data: {
            title: 'Alice Day 1',
            location: {
              lat: 37.77,
              lng: -122.42,
              geohash: '9q8yy7',
              placeName: 'San Francisco',
              source: 'gps',
            },
          },
        },
        {
          id: 'alice_entry_2',
          data: {
            title: 'Alice Day 2',
            location: {
              lat: 40.71,
              lng: -74.0,
              geohash: 'dr5reg',
              placeName: 'New York',
              source: 'gps',
            },
          },
        },
        {
          id: 'alice_entry_3',
          data: {
            title: 'Alice Day 3 without location',
            location: null,
          },
        }
      );

      // Seed Bob entries: 2 with location
      const bobEntries = getCollectionDocs('users/user_bob/entries');
      bobEntries.push(
        {
          id: 'bob_entry_1',
          data: {
            title: 'Bob Secret Location 1',
            location: {
              lat: 51.5,
              lng: -0.12,
              geohash: 'gcpvj0',
              placeName: 'London',
              source: 'gps',
            },
          },
        },
        {
          id: 'bob_entry_2',
          data: {
            title: 'Bob Secret Location 2',
            location: {
              lat: 48.85,
              lng: 2.35,
              geohash: 'u09tvw',
              placeName: 'Paris',
              source: 'gps',
            },
          },
        }
      );

      // Alice triggers bulk clear
      const res = await fetch(`${baseUrl}/api/places/clear-locations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_alice',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual({
        clearedCount: 2,
        success: true,
      });

      // Verify Alice's entries in store
      expect(aliceEntries[0].data.location).toBeNull();
      expect(aliceEntries[1].data.location).toBeNull();
      expect(aliceEntries[2].data.location).toBeNull();

      // EMPIRICAL TENANT ISOLATION CHECK: Verify Bob's entries were NOT touched
      expect(bobEntries).toHaveLength(2);
      expect(bobEntries[0].data.location).toEqual({
        lat: 51.5,
        lng: -0.12,
        geohash: 'gcpvj0',
        placeName: 'London',
        source: 'gps',
      });
      expect(bobEntries[1].data.location).toEqual({
        lat: 48.85,
        lng: 2.35,
        geohash: 'u09tvw',
        placeName: 'Paris',
        source: 'gps',
      });
    });

    it('ADV-ISO-02: Charlie with zero entries performs clear-locations safely returning count 0 and writing audit record', async () => {
      const res = await fetch(`${baseUrl}/api/places/clear-locations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_charlie',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual({
        clearedCount: 0,
        success: true,
      });

      // Audit log should still be recorded
      const charlieAudit = mockAuditLogs.find(
        (log) => log.actorUid === 'user_charlie' && log.action === 'LOCATION_BULK_CLEAR'
      );
      expect(charlieAudit).toBeDefined();
      expect(charlieAudit?.targetUid).toBe('user_charlie');
      expect(charlieAudit?.meta?.clearedCount).toBe(0);
    });
  });

  // =========================================================================
  // 4. Header Spoofing Immunity
  // =========================================================================
  describe('4. Header Spoofing Immunity', () => {
    const spoofHeaders = [
      { name: 'x-user-id header', headers: { 'x-user-id': 'user_bob' } },
      { name: 'x-uid header', headers: { 'x-uid': 'user_bob' } },
      { name: 'x-authenticated-user header', headers: { 'x-authenticated-user': 'user_bob' } },
      { name: 'x-forwarded-user header', headers: { 'x-forwarded-user': 'user_bob' } },
      { name: 'x-original-uid header', headers: { 'x-original-uid': 'user_bob' } },
      { name: 'x-actor-uid header', headers: { 'x-actor-uid': 'user_bob' } },
    ];

    for (let i = 0; i < spoofHeaders.length; i++) {
      const testCase = spoofHeaders[i];
      it(`ADV-SPOOF-01 [${testCase.name}]: identity remains strictly user_spoof_victim_${i} from verified token`, async () => {
        const victimUid = `user_spoof_victim_${i}`;
        const token = `token_spoof_victim_${i}`;

        // Seed victim and Bob entries
        const victimEntries = getCollectionDocs(`users/${victimUid}/entries`);
        victimEntries.length = 0;
        victimEntries.push({
          id: `victim_entry_${i}`,
          data: {
            title: 'Victim Entry',
            location: { lat: 37.77, lng: -122.42, placeName: 'SF', geohash: '9q8yy7', source: 'gps' },
          },
        });

        const bobEntries = getCollectionDocs('users/user_bob/entries');
        bobEntries.length = 0;
        bobEntries.push({
          id: `bob_entry_${i}`,
          data: {
            title: 'Bob Entry',
            location: { lat: 51.5, lng: -0.12, placeName: 'London', geohash: 'gcpvj0', source: 'gps' },
          },
        });

        const res = await fetch(`${baseUrl}/api/places/clear-locations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...testCase.headers,
          },
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data.clearedCount).toBe(1);

        // Victim cleared, Bob untouched
        expect(victimEntries[0].data.location).toBeNull();
        expect(bobEntries[0].data.location).not.toBeNull();
      });
    }
  });

  // =========================================================================
  // 5. Rate Limiting Burst Stress
  // =========================================================================
  describe('5. Burst Load & Rate Limiting Stress Test', () => {
    it('ADV-RATE-01: bursts exceeding bucket capacity (15) trigger 429 TOO_MANY_REQUESTS', async () => {
      const results: number[] = [];
      const burstUserToken = 'token_burst_user_1';

      // Fire 20 consecutive requests rapidly as burst_user_1
      for (let i = 0; i < 20; i++) {
        const res = await fetch(`${baseUrl}/api/places/reverse-geocode`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${burstUserToken}`,
          },
          body: JSON.stringify({ lat: 37.7749, lng: -122.4194 }),
        });
        results.push(res.status);
      }

      // Initial requests within capacity should succeed (200)
      const successCount = results.filter((s) => s === 200).length;
      // Requests exceeding capacity must be rate limited (429)
      const rateLimitedCount = results.filter((s) => s === 429).length;

      expect(successCount).toBe(15);
      expect(rateLimitedCount).toBe(5);
    });

    it('ADV-RATE-02: distinct user Bob is not blocked when another user exhausts their bucket', async () => {
      // Bob requests reverse-geocode
      const res = await fetch(`${baseUrl}/api/places/reverse-geocode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_fresh_bob',
        },
        body: JSON.stringify({ lat: 51.5074, lng: -0.1278 }),
      });

      // Bob should get 200 OK because rate limiting is keyed on req.user.uid
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.placeName).toBe('51.51°, -0.13°');
    });
  });

  // =========================================================================
  // 6. Audit Logging Verification
  // =========================================================================
  describe('6. Structured Audit Log Verification', () => {
    it('ADV-AUDIT-01: clearUserLocations creates immutable audit_logs document with expected schema', async () => {
      mockAuditLogs.length = 0;

      const clearedCount = await clearUserLocations('user_alice_audit');

      expect(clearedCount).toBe(0);
      expect(mockAuditLogs).toHaveLength(1);

      const log = mockAuditLogs[0];
      expect(log.actorUid).toBe('user_alice_audit');
      expect(log.action).toBe('LOCATION_BULK_CLEAR');
      expect(log.targetUid).toBe('user_alice_audit');
      expect(log.at).toBe('SERVER_TIMESTAMP_SENTINEL');
      expect(log.meta).toEqual({ clearedCount: 0 });
    });
  });

  // =========================================================================
  // 7. HTTP Method Fuzzing & Malformed Ingestion
  // =========================================================================
  describe('7. HTTP Method Fuzzing & Malformed Ingestion', () => {
    const invalidMethods = ['GET', 'PUT', 'DELETE', 'PATCH'];

    for (const method of invalidMethods) {
      it(`ADV-HTTP-01 [${method}]: rejected for /api/places/reverse-geocode with 404/405`, async () => {
        const res = await fetch(`${baseUrl}/api/places/reverse-geocode`, {
          method,
          headers: {
            Authorization: 'Bearer token_http_method_user',
            'Content-Type': 'application/json',
          },
        });
        expect([404, 405]).toContain(res.status);
      });
    }

    it('ADV-HTTP-02: non-JSON content type or malformed body returns clean 400 without unhandled 500 throw', async () => {
      const res = await fetch(`${baseUrl}/api/places/reverse-geocode`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token_malformed_user',
          'Content-Type': 'text/plain',
        },
        body: 'non-json string body',
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error?.code).toBe('BAD_REQUEST');
    });
  });
});
