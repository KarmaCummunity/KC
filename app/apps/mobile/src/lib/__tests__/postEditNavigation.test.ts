import { describe, expect, it } from 'vitest';
import { hrefForPostEdit } from '../postEditNavigation';

describe('hrefForPostEdit', () => {
  it('routes native listing worlds to edit-listing', () => {
    expect(
      hrefForPostEdit({ postId: 'p1', listingId: 'l1', listingWorldSlug: 'rides' }),
    ).toBe('/edit-listing/p1');
    expect(
      hrefForPostEdit({ postId: 'p2', listingId: 'l2', listingWorldSlug: 'food' }),
    ).toBe('/edit-listing/p2');
  });

  it('routes items and plain posts to edit-post', () => {
    expect(hrefForPostEdit({ postId: 'p3', listingId: null, listingWorldSlug: null })).toBe('/edit-post/p3');
    expect(hrefForPostEdit({ postId: 'p4', listingId: 'l4', listingWorldSlug: 'items' })).toBe('/edit-post/p4');
  });
});
