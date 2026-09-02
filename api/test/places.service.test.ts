import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateCoordinates,
  degradePrecision,
  encodeGeohash,
  reverseGeocode,
  resolveLocation,
} from '../src/services/places.js';

describe('Places Service (M4 Geospatial & Reverse Geocoding)', () => {
  describe('validateCoordinates', () => {
    it('POS-GEO-01: accepts valid coordinates within world bounds', () => {
      expect(validateCoordinates(37.7749, -122.4194)).toBe(true);
      expect(validateCoordinates(0, 0)).toBe(true);
      expect(validateCoordinates(90, 180)).toBe(true);
      expect(validateCoordinates(-90, -180)).toBe(true);
      expect(validateCoordinates(45.5, -73.56)).toBe(true);
    });

    it('NEG-GEO-01: rejects out-of-bounds latitude (>90 or <-90)', () => {
      expect(validateCoordinates(90.0001, 0)).toBe(false);
      expect(validateCoordinates(-90.0001, 0)).toBe(false);
      expect(validateCoordinates(100, 50)).toBe(false);
      expect(validateCoordinates(-95, 50)).toBe(false);
    });

    it('NEG-GEO-02: rejects out-of-bounds longitude (>180 or <-180)', () => {
      expect(validateCoordinates(0, 180.0001)).toBe(false);
      expect(validateCoordinates(0, -180.0001)).toBe(false);
      expect(validateCoordinates(45, 185)).toBe(false);
      expect(validateCoordinates(45, -190)).toBe(false);
    });

    it('NEG-GEO-03: rejects NaN, Infinity, -Infinity, non-numbers', () => {
      expect(validateCoordinates(NaN, 0)).toBe(false);
      expect(validateCoordinates(0, NaN)).toBe(false);
      expect(validateCoordinates(Infinity, 0)).toBe(false);
      expect(validateCoordinates(0, -Infinity)).toBe(false);
      expect(validateCoordinates('37.77' as any, -122.41)).toBe(false);
      expect(validateCoordinates(null as any, null as any)).toBe(false);
      expect(validateCoordinates(undefined as any, 0)).toBe(false);
    });
  });

  describe('degradePrecision', () => {
    it('POS-GEO-02: truncates float coordinates to 2 decimal places (~1.1 km)', () => {
      const degraded = degradePrecision(37.774929, -122.419416);
      expect(degraded.lat).toBe(37.77);
      expect(degraded.lng).toBe(-122.42);
    });

    it('POS-GEO-03: handles boundary values and eliminates negative zero (-0)', () => {
      const degraded = degradePrecision(-0.001, 0.001);
      expect(degraded.lat).toBe(0);
      expect(degraded.lng).toBe(0);
      expect(Object.is(degraded.lat, 0)).toBe(true);
      expect(Object.is(degraded.lng, 0)).toBe(true);
    });

    it('NEG-GEO-04: throws error when input coordinates are invalid', () => {
      expect(() => degradePrecision(95, 0)).toThrow('Invalid coordinate bounds');
      expect(() => degradePrecision(0, 200)).toThrow('Invalid coordinate bounds');
      expect(() => degradePrecision(NaN, 0)).toThrow('Invalid coordinate bounds');
    });
  });

  describe('encodeGeohash', () => {
    it('POS-GEO-04: computes standard Base32 geohash for San Francisco', () => {
      const hash = encodeGeohash(37.7749, -122.4194, 6);
      expect(hash).toBe('9q8yyk');
    });

    it('POS-GEO-05: computes standard geohash for Null Island (0, 0)', () => {
      const hash = encodeGeohash(0, 0, 6);
      expect(hash).toBe('s00000');
    });

    it('POS-GEO-06: computes valid geohashes for extreme world corners', () => {
      const hashNorthEast = encodeGeohash(90, 180, 6);
      const hashSouthWest = encodeGeohash(-90, -180, 6);
      expect(hashNorthEast.length).toBe(6);
      expect(hashSouthWest.length).toBe(6);
      // Valid Base32 characters only
      expect(/^[0123456789bcdefghjkmnpqrstuvwxyz]+$/.test(hashNorthEast)).toBe(true);
      expect(/^[0123456789bcdefghjkmnpqrstuvwxyz]+$/.test(hashSouthWest)).toBe(true);
    });

    it('NEG-GEO-05: throws when coordinates are out of bounds', () => {
      expect(() => encodeGeohash(91, 0)).toThrow('Invalid coordinate bounds');
      expect(() => encodeGeohash(0, -181)).toThrow('Invalid coordinate bounds');
    });
  });

  describe('reverseGeocode', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('POS-GEO-07: falls back to formatted coordinate label when test/empty key is used', async () => {
      const result = await reverseGeocode(37.7749, -122.4194);
      expect(result.lat).toBe(37.7749);
      expect(result.lng).toBe(-122.4194);
      expect(result.geohash).toBe('9q8yyk');
      expect(result.placeName).toBe('37.77°, -122.42°');
    });

    it('POS-GEO-08: parses and returns formatted address from valid upstream Geocoding API response', async () => {
      const { env } = await import('../src/config.js');
      const prevKey = env.MAPS_SERVER_API_KEY;
      (env as any).MAPS_SERVER_API_KEY = 'mock_server_api_key_valid';

      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: 'OK',
          results: [{ formatted_address: 'Market St, San Francisco, CA 94103, USA' }],
        }),
      })) as any;

      try {
        const result = await reverseGeocode(37.7749, -122.4194);
        expect(result.placeName).toBe('Market St, San Francisco, CA 94103, USA');
        expect(result.geohash).toBe('9q8yyk');
      } finally {
        (env as any).MAPS_SERVER_API_KEY = prevKey;
      }
    });

    it('POS-GEO-09: truncates oversized place name (>200 chars) from upstream to prevent storage bloat', async () => {
      const { env } = await import('../src/config.js');
      const prevKey = env.MAPS_SERVER_API_KEY;
      (env as any).MAPS_SERVER_API_KEY = 'mock_server_api_key_valid';

      const oversizedAddress = 'Super Long Place Address '.repeat(15);
      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: 'OK',
          results: [{ formatted_address: oversizedAddress }],
        }),
      })) as any;

      try {
        const result = await reverseGeocode(37.7749, -122.4194);
        expect(result.placeName.length).toBe(200);
        expect(result.placeName).toBe(oversizedAddress.slice(0, 200));
      } finally {
        (env as any).MAPS_SERVER_API_KEY = prevKey;
      }
    });

    it('POS-GEO-10: gracefully falls back to coordinate label on upstream non-OK HTTP status or error status', async () => {
      const { env } = await import('../src/config.js');
      const prevKey = env.MAPS_SERVER_API_KEY;
      (env as any).MAPS_SERVER_API_KEY = 'mock_server_api_key_valid';

      // 1. HTTP 500
      global.fetch = vi.fn(async () => ({
        ok: false,
        status: 500,
      })) as any;

      try {
        const res500 = await reverseGeocode(37.7749, -122.4194);
        expect(res500.placeName).toBe('37.77°, -122.42°');

        // 2. OVER_QUERY_LIMIT
        global.fetch = vi.fn(async () => ({
          ok: true,
          json: async () => ({ status: 'OVER_QUERY_LIMIT', results: [] }),
        })) as any;

        const resLimit = await reverseGeocode(37.7749, -122.4194);
        expect(resLimit.placeName).toBe('37.77°, -122.42°');

        // 3. ZERO_RESULTS
        global.fetch = vi.fn(async () => ({
          ok: true,
          json: async () => ({ status: 'ZERO_RESULTS', results: [] }),
        })) as any;

        const resZero = await reverseGeocode(37.7749, -122.4194);
        expect(resZero.placeName).toBe('37.77°, -122.42°');

        // 4. Network throw / fetch failure
        global.fetch = vi.fn(async () => {
          throw new Error('Network timeout connecting to maps.googleapis.com');
        }) as any;

        const resNetErr = await reverseGeocode(37.7749, -122.4194);
        expect(resNetErr.placeName).toBe('37.77°, -122.42°');
      } finally {
        (env as any).MAPS_SERVER_API_KEY = prevKey;
      }
    });

    it('NEG-GEO-06: throws on invalid coordinates', async () => {
      await expect(reverseGeocode(100, 0)).rejects.toThrow('Invalid coordinate bounds');
    });
  });

  describe('resolveLocation', () => {
    it('POS-GEO-11: resolves complete location with precision degradation and source', async () => {
      const location = await resolveLocation(37.774929, -122.419416, {
        degrade: true,
        source: 'gps',
      });

      expect(location.lat).toBe(37.77);
      expect(location.lng).toBe(-122.42);
      expect(location.geohash).toBe('9q8yy7');
      expect(location.placeName).toBe('37.77°, -122.42°');
      expect(location.source).toBe('gps');
    });

    it('POS-GEO-12: resolves location without precision degradation if degrade is false', async () => {
      const location = await resolveLocation(37.7749, -122.4194, {
        degrade: false,
        source: 'manual',
      });

      expect(location.lat).toBe(37.7749);
      expect(location.lng).toBe(-122.4194);
      expect(location.source).toBe('manual');
    });
  });
});
