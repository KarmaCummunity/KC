import { describe, expect, it } from 'vitest';
import { buildListingShareUrl } from '../buildListingShareUrl';

const BASE = 'https://karma-community-kc.com';
const LISTING_ID = '11111111-1111-4111-8111-111111111111';
const POST_ID = '22222222-2222-4222-8222-222222222222';

describe('buildListingShareUrl (G1 step 4c)', () => {
  it('shares the post of a listing that has one', () => {
    expect(buildListingShareUrl({ listingId: LISTING_ID, feedPostId: POST_ID }, BASE)).toBe(
      `${BASE}/post/${POST_ID}`,
    );
  });

  it('shares the marketplace page of a listing without a post', () => {
    expect(buildListingShareUrl({ listingId: LISTING_ID, feedPostId: null }, BASE)).toBe(
      `${BASE}/donations/marketplace/${LISTING_ID}`,
    );
  });
});
