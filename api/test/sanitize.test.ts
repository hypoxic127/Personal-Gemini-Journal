import { describe, it, expect } from 'vitest';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { stripUndefined, isFirestoreSentinel, truncateText } from '../src/lib/sanitize.js';

describe('stripUndefined', () => {
  it('POS-SAN-01: removes undefined fields at every depth', () => {
    const out = stripUndefined({
      a: 1,
      b: undefined,
      nested: { keep: 'yes', drop: undefined, deeper: { drop: undefined, keep: 0 } },
      list: [{ keep: true, drop: undefined }],
    });

    expect(out).toEqual({
      a: 1,
      nested: { keep: 'yes', deeper: { keep: 0 } },
      list: [{ keep: true }],
    });
    expect('b' in out).toBe(false);
  });

  it('POS-SAN-02: preserves serverTimestamp() sentinels and Date — the reason not to use JSON round-tripping', () => {
    const sentinel = FieldValue.serverTimestamp();
    const increment = FieldValue.increment(1);
    const date = new Date('2026-09-02T00:00:00.000Z');
    const ts = Timestamp.fromDate(date);

    const out = stripUndefined({ createdAt: sentinel, entryCount: increment, when: date, stamped: ts });

    expect(out.createdAt).toBe(sentinel);
    expect(out.entryCount).toBe(increment);
    expect(out.when).toBe(date);
    expect(out.stamped).toBe(ts);

    // The shortcut this function exists to replace destroys all four.
    const viaJson = JSON.parse(JSON.stringify({ createdAt: sentinel, when: date }));
    expect(viaJson.createdAt).toEqual({});
    expect(typeof viaJson.when).toBe('string');
  });

  it('POS-SAN-03: keeps null (a meaningful Firestore value) and leaves primitives alone', () => {
    expect(stripUndefined({ location: null, n: 0, s: '', b: false })).toEqual({
      location: null,
      n: 0,
      s: '',
      b: false,
    });
  });

  it('POS-SAN-04: recognises sentinels explicitly', () => {
    expect(isFirestoreSentinel(FieldValue.serverTimestamp())).toBe(true);
    expect(isFirestoreSentinel(Timestamp.now())).toBe(true);
    expect(isFirestoreSentinel(new Date())).toBe(true);
    expect(isFirestoreSentinel({ plain: 'object' })).toBe(false);
    expect(isFirestoreSentinel(null)).toBe(false);
  });
});

describe('truncateText', () => {
  it('POS-SAN-05: truncates past the cap and leaves shorter text untouched', () => {
    expect(truncateText('x'.repeat(9000), 4000)).toHaveLength(4000);
    expect(truncateText('short', 4000)).toBe('short');
  });
});
