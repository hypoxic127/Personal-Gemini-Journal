import { env } from '../config.js';
import { truncateText } from '../lib/sanitize.js';
import { type LocationData } from '@journal/shared';

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface ResolvedLocation {
  lat: number;
  lng: number;
  geohash: string;
  placeName: string;
  source: 'gps' | 'manual';
}

/**
 * Validate coordinates range and finiteness.
 * Enforces lat in [-90, 90], lng in [-180, 180], finite numbers only.
 */
export function validateCoordinates(lat: number, lng: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Precision degradation: truncates coordinates to 2 decimal places (~1.1 km resolution).
 * Preserves 0 and negative floats accurately, eliminating negative zero (-0).
 */
export function degradePrecision(lat: number, lng: number, decimals = 2): Coordinates {
  if (!validateCoordinates(lat, lng)) {
    throw new Error('Invalid coordinate bounds for precision degradation');
  }
  const factor = Math.pow(10, decimals);
  const rawLat = Math.round(lat * factor) / factor;
  const rawLng = Math.round(lng * factor) / factor;
  const sanitizeZero = (n: number) => (Object.is(n, -0) ? 0 : n);

  return {
    lat: sanitizeZero(rawLat),
    lng: sanitizeZero(rawLng),
  };
}

/**
 * Encodes latitude and longitude into a standard Base32 geohash.
 * Default precision is 6 characters (~1.2 km resolution).
 */
export function encodeGeohash(lat: number, lng: number, precision = 6): string {
  if (!validateCoordinates(lat, lng)) {
    throw new Error('Invalid coordinate bounds for geohash encoding');
  }

  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  let geohash = '';
  let isEven = true;
  let bit = 0;
  let ch = 0;

  while (geohash.length < precision) {
    if (isEven) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch |= 1 << (4 - bit);
        lngMin = mid;
      } else {
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch |= 1 << (4 - bit);
        latMin = mid;
      } else {
        latMax = mid;
      }
    }

    isEven = !isEven;
    if (bit < 4) {
      bit++;
    } else {
      geohash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return geohash;
}

/**
 * Reverse geocodes coordinates via Google Maps Geocoding API using MAPS_SERVER_API_KEY.
 * Discards client placeName/geohash and recomputes authoritative values server-side.
 * Gracefully falls back to coordinate label if key is unset, upstream fails, or timeout.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  options: { correlationId?: string; timeoutMs?: number } = {}
): Promise<{ lat: number; lng: number; geohash: string; placeName: string }> {
  if (!validateCoordinates(lat, lng)) {
    throw new Error('Invalid coordinate bounds');
  }

  const geohash = encodeGeohash(lat, lng, 6);
  const fallbackPlace = `${lat.toFixed(2)}°, ${lng.toFixed(2)}°`;
  const apiKey = env.MAPS_SERVER_API_KEY;

  if (!apiKey || apiKey === 'test-maps-server-key') {
    return {
      lat,
      lng,
      geohash,
      placeName: fallbackPlace,
    };
  }

  const timeoutMs = options.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: controller.signal });

    if (!res.ok) {
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          correlationId: options.correlationId,
          event: 'GEOCODE_API_HTTP_ERROR',
          status: res.status,
        })
      );
      return { lat, lng, geohash, placeName: fallbackPlace };
    }

    const data: any = await res.json();
    if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
      const formatted = data.results[0].formatted_address || fallbackPlace;
      const placeName = truncateText(formatted, 200);
      return { lat, lng, geohash, placeName };
    }

    if (data.status === 'ZERO_RESULTS') {
      return { lat, lng, geohash, placeName: fallbackPlace };
    }

    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        correlationId: options.correlationId,
        event: 'GEOCODE_API_NON_OK_STATUS',
        status: data.status,
      })
    );
    return { lat, lng, geohash, placeName: fallbackPlace };
  } catch (err: any) {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        correlationId: options.correlationId,
        event: 'GEOCODE_REQUEST_FAILED',
        error: err?.message,
      })
    );
    return { lat, lng, geohash, placeName: fallbackPlace };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Helper to resolve complete location object for entry persistence.
 */
export async function resolveLocation(
  lat: number,
  lng: number,
  options: { degrade?: boolean; source?: 'gps' | 'manual'; correlationId?: string } = {}
): Promise<LocationData> {
  const coords = options.degrade ? degradePrecision(lat, lng) : { lat, lng };
  const geocoded = await reverseGeocode(coords.lat, coords.lng, {
    correlationId: options.correlationId,
  });

  return {
    lat: coords.lat,
    lng: coords.lng,
    geohash: geocoded.geohash,
    placeName: geocoded.placeName,
    source: options.source ?? 'gps',
  };
}
