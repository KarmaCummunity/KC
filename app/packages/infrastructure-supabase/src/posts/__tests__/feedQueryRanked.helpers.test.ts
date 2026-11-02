import { describe, it, expect } from 'vitest';
import type { PostFeedFilter } from '@kc/application';
import {
  decodeRankedCursor,
  encodeRankedCursor,
  needsRankedPath,
  type RankedCursor,
} from '../feedQueryRanked';

describe('encodeRankedCursor', () => {
  it('round-trips a full cursor through decode', () => {
    const original: RankedCursor = {
      distanceKm: 12.5,
      createdAt: '2026-05-16T12:00:00.000Z',
      postId: 'p_1',
    };

    const encoded = encodeRankedCursor(original);
    const decoded = decodeRankedCursor(encoded);

    expect(decoded).toEqual({ ...original, rankScore: null });
  });

  it('round-trips a cursor whose distanceKm is null (newest/oldest sort)', () => {
    const original: RankedCursor = {
      distanceKm: null,
      createdAt: '2026-05-16T12:00:00.000Z',
      postId: 'p_1',
    };

    expect(decodeRankedCursor(encodeRankedCursor(original))).toEqual({
      ...original,
      rankScore: null,
    });
  });

  it('produces a URL-safe string (no raw braces / quotes from JSON)', () => {
    const encoded = encodeRankedCursor({
      distanceKm: 1,
      createdAt: '2026-05-16T12:00:00.000Z',
      postId: 'p_1',
    });

    expect(encoded).not.toContain('{');
    expect(encoded).not.toContain('"');
    expect(encoded).not.toContain(' ');
  });
});

describe('decodeRankedCursor', () => {
  it('returns null for undefined input', () => {
    expect(decodeRankedCursor(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodeRankedCursor('')).toBeNull();
  });

  it('returns null for malformed (non-JSON) input', () => {
    expect(decodeRankedCursor('not-json')).toBeNull();
  });

  it('returns null when createdAt is missing', () => {
    const raw = encodeURIComponent(JSON.stringify({ distanceKm: 1, postId: 'p_1' }));
    expect(decodeRankedCursor(raw)).toBeNull();
  });

  it('returns null when postId is missing', () => {
    const raw = encodeURIComponent(JSON.stringify({ distanceKm: 1, createdAt: '2026-01-01' }));
    expect(decodeRankedCursor(raw)).toBeNull();
  });

  it('returns null when createdAt is not a string', () => {
    const raw = encodeURIComponent(
      JSON.stringify({ distanceKm: 1, createdAt: 123, postId: 'p_1' }),
    );
    expect(decodeRankedCursor(raw)).toBeNull();
  });

  it('coalesces a non-number distanceKm to null (defensive)', () => {
    // A stray string distanceKm shouldn't reject the whole cursor —
    // the createdAt+postId pair is still a valid keyset position.
    const raw = encodeURIComponent(
      JSON.stringify({ distanceKm: 'oops', createdAt: '2026-01-01', postId: 'p_1' }),
    );

    expect(decodeRankedCursor(raw)).toEqual({
      distanceKm: null,
      createdAt: '2026-01-01',
      postId: 'p_1',
      rankScore: null,
    });
  });

  it('accepts a missing distanceKm field as null', () => {
    const raw = encodeURIComponent(JSON.stringify({ createdAt: '2026-01-01', postId: 'p_1' }));

    expect(decodeRankedCursor(raw)).toEqual({
      distanceKm: null,
      createdAt: '2026-01-01',
      postId: 'p_1',
      rankScore: null,
    });
  });

});

describe('needsRankedPath', () => {
  it('returns false for an empty filter (default newest sort, no location, no follow)', () => {
    expect(needsRankedPath({})).toBe(false);
  });

  it("returns true when sortOrder === 'distance'", () => {
    expect(needsRankedPath({ sortOrder: 'distance' })).toBe(true);
  });

  it("returns true when sortOrder === 'personalized'", () => {
    expect(needsRankedPath({ sortOrder: 'personalized' })).toBe(true);
  });

  it('returns true when locationFilter has a positive radiusKm', () => {
    const filter: PostFeedFilter = {
      locationFilter: { centerCity: 'IL-001', centerCityName: 'Tel Aviv', radiusKm: 10 },
    };
    expect(needsRankedPath(filter)).toBe(true);
  });

  it('returns false when locationFilter has radiusKm === 0 (degenerate)', () => {
    const filter: PostFeedFilter = {
      locationFilter: { centerCity: 'IL-001', centerCityName: 'Tel Aviv', radiusKm: 0 },
    };
    expect(needsRankedPath(filter)).toBe(false);
  });

  it('returns false when locationFilter has a negative radiusKm', () => {
    const filter: PostFeedFilter = {
      locationFilter: { centerCity: 'IL-001', centerCityName: 'Tel Aviv', radiusKm: -5 },
    };
    expect(needsRankedPath(filter)).toBe(false);
  });

  it('returns true when followersOnly is true (FR-FEED-020)', () => {
    expect(needsRankedPath({ followersOnly: true })).toBe(true);
  });

  it('returns true when subcategories is non-empty', () => {
    expect(needsRankedPath({ subcategories: ['books'] })).toBe(true);
  });

  it('returns false when subcategories is empty', () => {
    expect(needsRankedPath({ subcategories: [] })).toBe(false);
  });

  it('returns false when followersOnly is false', () => {
    expect(needsRankedPath({ followersOnly: false })).toBe(false);
  });

  it('returns true if ANY ranked trigger is set, even alongside non-triggers', () => {
    expect(
      needsRankedPath({
        type: 'Give',
        categories: ['Electronics'],
        sortOrder: 'distance',
      }),
    ).toBe(true);
  });
});
