import { describe, expect, it } from 'vitest';
import {
  decodePageCursor,
  encodeKeysetCursor,
  encodePageCursor,
  keysetAfterFilter,
  parseKeysetCursor,
} from '../pageCursor';

const ID = '3f9c2f0e-6a5b-4c3e-9a41-0b9d1f6a7c11';

describe('page cursor (JSON of a page function)', () => {
  it('round-trips the object a page function returned', () => {
    const next = { sort: 'newest', as_of: '2026-01-01T00:00:00Z', id: ID };
    expect(decodePageCursor(encodePageCursor(next))).toEqual(next);
  });

  it('encodes the absence of a next page as null', () => {
    expect(encodePageCursor(null)).toBeNull();
    expect(encodePageCursor(undefined)).toBeNull();
  });

  it('starts at the first page for a missing, malformed or non-object cursor', () => {
    expect(decodePageCursor(undefined)).toBeNull();
    expect(decodePageCursor('')).toBeNull();
    expect(decodePageCursor('not json')).toBeNull();
    expect(decodePageCursor('[1,2]')).toBeNull();
    expect(decodePageCursor('"text"')).toBeNull();
  });
});

describe('keyset cursor (table reads)', () => {
  it('round-trips a time and an id', () => {
    const cursor = { t: '2026-01-01T10:00:00.123+00:00', id: ID };
    expect(parseKeysetCursor(encodeKeysetCursor(cursor))).toEqual(cursor);
  });

  it('rejects a value that could inject a filter (CWE-943)', () => {
    expect(parseKeysetCursor(JSON.stringify({ t: '2026-01-01T00:00:00Z),id.gt.0', id: ID }))).toBeNull();
    expect(parseKeysetCursor(JSON.stringify({ t: '2026-01-01T00:00:00Z', id: `${ID},status.eq.open` }))).toBeNull();
    expect(parseKeysetCursor('garbage')).toBeNull();
    expect(parseKeysetCursor(undefined)).toBeNull();
  });

  it('builds the "after this row" filter of a newest-first order', () => {
    const filter = keysetAfterFilter('created_at', 'id', { t: '2026-01-01T00:00:00Z', id: ID });
    expect(filter).toBe(`created_at.lt.2026-01-01T00:00:00Z,and(created_at.eq.2026-01-01T00:00:00Z,id.lt.${ID})`);
  });
});
