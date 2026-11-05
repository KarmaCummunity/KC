import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseMarketplaceRepository } from '../SupabaseMarketplaceRepository';

describe('SupabaseMarketplaceRepository', () => {
  it('maps browse_listings rows', async () => {
    const client = {
      rpc: async (name: string) => {
        expect(name).toBe('browse_listings');
        return {
          data: [
            {
              listing_id: 'l1',
              world_slug: 'items',
              kind_slug: 'give_item',
              direction: 'give',
              title: 'Chair',
              summary: null,
              urgency_level: 2,
              availability_status: 'ongoing',
              city_id: 'tel-aviv',
              distance_km: 3,
              geo: null,
            },
          ],
          error: null,
        };
      },
    } as unknown as SupabaseClient;
    const repo = new SupabaseMarketplaceRepository(client);
    const out = await repo.browse({ limit: 5 });
    expect(out[0]?.listingId).toBe('l1');
    expect(out[0]?.worldSlug).toBe('items');
  });
});

// G1 step 6a-5h (D-214): a post-owned listing's card reads its post; other shapes read the listing.
describe('SupabaseMarketplaceRepository — getListingCard by shape', () => {
  type Result = { data: unknown; error: unknown };
  function clientWith(listing: Result, kind: Result = { data: { slug: 'ride_offer' }, error: null }) {
    const tables: string[] = [];
    const client = {
      from: (table: string) => {
        tables.push(table);
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq']) b[m] = () => b;
        b.maybeSingle = async () => (table === 'listings' ? listing : kind);
        return b;
      },
    } as unknown as SupabaseClient;
    return { repo: new SupabaseMarketplaceRepository(client), tables };
  }
  const listing = {
    listing_id: 'l1', world_slug: 'rides', direction: 'give', title: 'A long listing title', summary: 's',
    urgency_level: 2, availability_status: 'scheduled', city_id: 'tel-aviv', kind_id: 'k1',
    origin: 'native', legacy_post_id: null, post: null,
  };
  const syncedPost = { world_slug: 'rides', direction: 'offer', urgency_level: 2, availability_status: 'scheduled',
    details: {}, kind: { slug: 'ride_offer' }, publisher: null };

  it('gives a post-owned listing the same card from its post, without the kind query', async () => {
    const fromListing = clientWith({ data: listing, error: null });
    const fromPost = clientWith({ data: { ...listing, legacy_post_id: 'p1', post: syncedPost }, error: null });
    const expected = await fromListing.repo.getListingCard('l1');
    expect(await fromPost.repo.getListingCard('l1')).toEqual(expected);
    expect(expected).toMatchObject({ kindSlug: 'ride_offer', direction: 'give', title: 'A long listing title' });
    expect(fromListing.tables).toEqual(['listings', 'listing_kinds']);
    expect(fromPost.tables).toEqual(['listings']);
  });

  it('reads the listing for an items post and when the post is hidden; null when missing', async () => {
    const other = { ...syncedPost, world_slug: 'food', kind: { slug: 'other' } };
    const items = clientWith({ data: { ...listing, origin: 'post', legacy_post_id: 'p2', post: other }, error: null });
    expect(await items.repo.getListingCard('l1')).toMatchObject({ worldSlug: 'rides', kindSlug: 'ride_offer' });
    const hidden = clientWith({ data: { ...listing, legacy_post_id: 'p3', post: null }, error: null });
    expect(await hidden.repo.getListingCard('l1')).toMatchObject({ worldSlug: 'rides', kindSlug: 'ride_offer' });
    expect(await clientWith({ data: null, error: null }).repo.getListingCard('x')).toBeNull();
  });
});
