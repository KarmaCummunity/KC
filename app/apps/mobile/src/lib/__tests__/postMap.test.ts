import { describe, it, expect } from 'vitest';
import type { PostWithOwner } from '@kc/application';
import {
  decodeMapFilter,
  encodeMapFilter,
  mapFeedFilter,
  mapFilterCount,
  postToMapPin,
  postsToMapPins,
} from '../postMap';

function post(overrides: Partial<PostWithOwner> = {}): PostWithOwner {
  return {
    postId: 'p1',
    type: 'Give',
    title: 'Sofa',
    description: 'Grey',
    listingWorldSlug: null,
    mapPoint: { lat: 32.085, lng: 34.782 },
    ...overrides,
  } as PostWithOwner;
}

describe('postToMapPin', () => {
  it('maps a positioned post to a pin keyed by its post id, items world by default', () => {
    expect(postToMapPin(post())).toMatchObject({
      listingId: 'p1',
      worldSlug: 'items',
      direction: 'give',
      title: 'Sofa',
      lat: 32.085,
      lng: 34.782,
    });
  });

  it("uses the post's giving world and request direction", () => {
    expect(postToMapPin(post({ listingWorldSlug: 'rides', type: 'Request' }))).toMatchObject({
      worldSlug: 'rides',
      direction: 'request',
    });
  });

  it('skips posts without a position', () => {
    expect(postToMapPin(post({ mapPoint: null }))).toBeNull();
    expect(postsToMapPins([post(), post({ postId: 'p2', mapPoint: null })]).map((p) => p.listingId)).toEqual(['p1']);
  });
});

describe('map filter route param', () => {
  it('round-trips the sheet value on the main map', () => {
    const value = { ...decodeMapFilter(undefined, null), worlds: ['food'], type: 'Give' as const, searchQuery: 'soup' };
    expect(decodeMapFilter(encodeMapFilter(value), null)).toEqual(value);
  });

  it("keeps a world's map on its world whatever the param says", () => {
    const value = { ...decodeMapFilter(undefined, null), worlds: ['items'] };
    expect(decodeMapFilter(encodeMapFilter(value), 'rides').worlds).toEqual(['rides']);
  });

  it('starts from the defaults when the param is missing or malformed', () => {
    expect(decodeMapFilter(undefined, null)).toMatchObject({ worlds: [], statusFilter: 'open', sortOrder: 'newest', searchQuery: '' });
    expect(decodeMapFilter('{oops', 'food').worlds).toEqual(['food']);
    expect(decodeMapFilter('[1]', null).worlds).toEqual([]);
  });
});

describe('mapFeedFilter / mapFilterCount', () => {
  const base = decodeMapFilter(undefined, null);

  it("queries the main map with the sheet's worlds, a world's map with its own world", () => {
    expect(mapFeedFilter({ ...base, worlds: ['food'] }, null).worlds).toEqual(['food']);
    expect(mapFeedFilter({ ...base, worlds: [] }, null).worlds).toEqual([]);
    expect(mapFeedFilter({ ...base, worlds: ['food'] }, 'rides').worlds).toEqual(['rides']);
  });

  it('runs a search only from two characters, as the feed does', () => {
    expect(mapFeedFilter({ ...base, searchQuery: ' a ' }, null).searchQuery).toBeUndefined();
    expect(mapFeedFilter({ ...base, searchQuery: ' soup ' }, null).searchQuery).toBe('soup');
  });

  it('counts a picked world on the main map only', () => {
    expect(mapFilterCount({ ...base, worlds: ['food'] }, null)).toBe(1);
    expect(mapFilterCount({ ...base, worlds: ['food'] }, 'food')).toBe(0);
    expect(mapFilterCount({ ...base, type: 'Give', followersOnly: true }, null)).toBe(2);
  });
});
