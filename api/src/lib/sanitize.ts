import {
  FieldValue,
  Timestamp,
  GeoPoint,
  DocumentReference,
} from 'firebase-admin/firestore';

/**
 * Values that carry meaning to Firestore beyond their own fields: write sentinels
 * (`serverTimestamp()`, `increment()`), timestamps, geo points, and references. The
 * sanitizer must hand these through untouched — walking into one and rebuilding it as a
 * plain object turns `serverTimestamp()` into `{}` and silently stops your timestamps
 * working.
 */
export const isFirestoreSentinel = (value: unknown): boolean =>
  value instanceof FieldValue ||
  value instanceof Timestamp ||
  value instanceof GeoPoint ||
  value instanceof DocumentReference ||
  value instanceof Date ||
  Buffer.isBuffer(value);

/**
 * Remove `undefined` at every depth before a Firestore write. Firestore rejects an
 * `undefined` field value outright, so a single unset optional field fails the whole write.
 *
 * Deliberately NOT `JSON.parse(JSON.stringify(payload))`: that shortcut destroys exactly the
 * values above — sentinels become `{}`, `Date` becomes a string — and the damage is silent.
 *
 * `null` is preserved: in Firestore it is a real, meaningful value ("this entry has no
 * location"), not an absence.
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter((v) => v !== undefined).map((v) => stripUndefined(v)) as unknown as T;
  }
  if (value === null || typeof value !== 'object') return value;
  if (isFirestoreSentinel(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (val !== undefined) out[key] = stripUndefined(val);
  }
  return out as T;
}

/** Cut text to a hard limit. Server-side; the form's own counter is a courtesy, not a control. */
export const truncateText = (text: string, max: number): string =>
  text.length <= max ? text : text.slice(0, max);
