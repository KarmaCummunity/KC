import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseMarketplaceRepository } from '../SupabaseMarketplaceRepository';

type Result = { data: unknown; error: unknown };

function makeClient(rpcResults: Record<string, Result>, tableResults: Record<string, Result[]> = {}) {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const fromCalls: string[] = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcResults[fn] ?? { data: null, error: null };
    },
    from: (table: string) => {
      fromCalls.push(table);
      const queue = tableResults[table] ?? [];
      const result = queue.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) builder[m] = () => builder;
      builder.maybeSingle = async () => result;
      builder.then = (resolve: (r: Result) => unknown) => resolve(result);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { repo: new SupabaseMarketplaceRepository(client as never), rpcCalls, fromCalls };
}

const ok = (data: unknown): Result => ({ data, error: null });
const fail: Result = { data: null, error: { message: 'boom' } };

describe('SupabaseMarketplaceRepository — read RPCs', () => {
  it('browse passes filters and returns [] on error', async () => {
    const { repo, rpcCalls } = makeClient({ browse_listings: fail });
    expect(await repo.browse({ worldSlug: 'items', direction: 'give', radiusKm: 5 })).toEqual([]);
    expect(rpcCalls[0]).toMatchObject({
      fn: 'browse_listings',
      args: { p_world_slug: 'items', p_direction: 'give', p_radius_km: 5, p_limit: 24, p_offset: 0 },
    });
  });

  it('search and recommendForYou map listing ids', async () => {
    const { repo } = makeClient({
      marketplace_search: ok([{ listing_id: 'a' }, { listing_id: 'b' }]),
      recommend_listings_for_user: ok([{ listing_id: 'c' }]),
    });
    expect(await repo.search('chair', 'items')).toEqual(['a', 'b']);
    expect(await repo.recommendForYou()).toEqual(['c']);
  });

  it('search and recommendForYou return [] on error', async () => {
    const { repo } = makeClient({ marketplace_search: fail, recommend_listings_for_user: fail });
    expect(await repo.search('x')).toEqual([]);
    expect(await repo.recommendForYou(3)).toEqual([]);
  });

  it('mapClusters maps cluster rows', async () => {
    const { repo, rpcCalls } = makeClient({
      map_listing_clusters: ok([
        { cluster_key: 'k', center_lat: 32, center_lng: 34.8, listing_count: 3, sample_listing_id: 'l1' },
      ]),
    });
    const out = await repo.mapClusters({ swLat: 31, swLng: 34, neLat: 33, neLng: 35, worldSlug: 'food' });
    expect(out).toEqual([
      { clusterKey: 'k', centerLat: 32, centerLng: 34.8, listingCount: 3, sampleListingId: 'l1' },
    ]);
    expect(rpcCalls[0]?.args).toMatchObject({ p_world_slug: 'food' });
    const { repo: bad } = makeClient({ map_listing_clusters: fail });
    expect(await bad.mapClusters({ swLat: 0, swLng: 0, neLat: 1, neLng: 1 })).toEqual([]);
  });

  it('mapPins maps pin rows and passes filters', async () => {
    const { repo, rpcCalls } = makeClient({
      map_listing_pins: ok([
        { listing_id: 'l1', world_slug: 'food', kind_slug: 'k', direction: 'give', title: 'T', summary: null,
          lat: 31.95, lng: 34.89, origin_lat: null, origin_lng: null, dest_lat: null, dest_lng: null,
          origin_label: null, dest_label: null, departs_at: null, seats: null },
      ]),
    });
    const out = await repo.mapPins({ swLat: 31, swLng: 34, neLat: 33, neLng: 35, worldSlug: 'food', limit: 50 });
    expect(out[0]).toMatchObject({ listingId: 'l1', worldSlug: 'food', lat: 31.95 });
    expect(rpcCalls[0]?.args).toMatchObject({ p_world_slug: 'food', p_limit: 50 });
    const { repo: bad } = makeClient({ map_listing_pins: fail });
    expect(await bad.mapPins({ swLat: 0, swLng: 0, neLat: 1, neLng: 1 })).toEqual([]);
  });

  it('getListingDetail returns null on error and maps json otherwise', async () => {
    const { repo: bad } = makeClient({ get_marketplace_listing_detail: fail });
    expect(await bad.getListingDetail('l1')).toBeNull();
    const { repo } = makeClient({
      get_marketplace_listing_detail: ok({
        listing_id: 'l1',
        owner_id: 'u1',
        world_slug: 'items',
        kind_slug: 'give_item',
        direction: 'give',
        title: 'Chair',
        details: {},
        media: [],
        owner: { user_id: 'u1', display_name: 'Ada', avatar_url: null, share_handle: 'ada', city_id: null },
      }),
    });
    expect((await repo.getListingDetail('l1'))?.listingId).toBe('l1');
  });

  it('similarListings maps rows and handles errors', async () => {
    const { repo } = makeClient({
      similar_listings: ok([{ listing_id: 's1', title: 'T', world_slug: 'items', kind_slug: 'give_item' }]),
    });
    expect(await repo.similarListings('l1')).toEqual([
      { listingId: 's1', title: 'T', worldSlug: 'items', kindSlug: 'give_item' },
    ]);
    const { repo: bad } = makeClient({ similar_listings: fail });
    expect(await bad.similarListings('l1', 2)).toEqual([]);
  });

  it('listMyListings and listProfileListings map rows and handle errors', async () => {
    const row = {
      listing_id: 'm1',
      world_slug: 'items',
      kind_slug: 'give_item',
      direction: 'give',
      status: 'open',
      title: 'Mine',
      summary: null,
      urgency_level: 1,
      availability_status: 'ongoing',
      updated_at: '2026-10-17T00:00:00Z',
    };
    const { repo } = makeClient({ list_my_listings: ok([row]), list_profile_listings: ok([row]) });
    expect((await repo.listMyListings())[0]).toMatchObject({ listingId: 'm1', updatedAt: row.updated_at });
    expect((await repo.listProfileListings('u1'))[0]).toMatchObject({ listingId: 'm1', status: 'open' });
    const { repo: bad } = makeClient({ list_my_listings: fail, list_profile_listings: fail });
    expect(await bad.listMyListings(5, 5)).toEqual([]);
    expect(await bad.listProfileListings('u1', 3)).toEqual([]);
  });
});

describe('SupabaseMarketplaceRepository — table reads', () => {
  it('listKindsForWorld maps kinds and handles errors', async () => {
    const { repo, fromCalls } = makeClient({}, {
      listing_kinds: [
        ok([
          { kind_id: 'k1', slug: 'give_item', label_en: 'Give', label_he: 'G', direction: 'give', detail_schema: null },
        ]),
        fail,
      ],
    });
    expect(await repo.listKindsForWorld('items')).toEqual([
      { kindId: 'k1', slug: 'give_item', labelEn: 'Give', labelHe: 'G', direction: 'give', detailSchema: {} },
    ]);
    expect(await repo.listKindsForWorld('items')).toEqual([]);
    expect(fromCalls).toEqual(['listing_kinds', 'listing_kinds']);
  });

  it('getListingCard joins the kind slug and returns null when missing', async () => {
    const listing = {
      listing_id: 'l1',
      world_slug: 'items',
      direction: 'give',
      title: 'Chair',
      summary: null,
      urgency_level: 2,
      availability_status: 'ongoing',
      city_id: 'tel-aviv',
      kind_id: 'k1',
    };
    const { repo } = makeClient({}, {
      listings: [ok(listing), ok(null)],
      listing_kinds: [ok({ slug: 'give_item' })],
    });
    expect(await repo.getListingCard('l1')).toMatchObject({ listingId: 'l1', kindSlug: 'give_item', distanceKm: null });
    expect(await repo.getListingCard('missing')).toBeNull();
  });
});

describe('SupabaseMarketplaceRepository — writes', () => {
  it('createListing, shareToFeed and startChat return ids', async () => {
    const { repo, rpcCalls } = makeClient({
      create_marketplace_listing: ok('new-id'),
      share_listing_to_feed: ok('post-id'),
      start_listing_chat: ok('chat-id'),
    });
    expect(await repo.createListing({ kindId: 'k1', title: 'Chair' } as never)).toBe('new-id');
    expect(await repo.shareToFeed('l1')).toBe('post-id');
    expect(await repo.startChat('l1', 'hi')).toBe('chat-id');
    expect(rpcCalls[0]?.args).toMatchObject({ p_kind_id: 'k1', p_title: 'Chair', p_details: {} });
  });

  it('createListing, shareToFeed and startChat throw on error', async () => {
    const { repo } = makeClient({
      create_marketplace_listing: fail,
      share_listing_to_feed: ok(null),
      start_listing_chat: fail,
    });
    await expect(repo.createListing({ kindId: 'k1', title: 'x' } as never)).rejects.toMatchObject({ message: 'boom' });
    await expect(repo.shareToFeed('l1')).rejects.toThrow('share_listing_to_feed failed');
    await expect(repo.startChat('l1')).rejects.toMatchObject({ message: 'boom' });
  });

  it('recordSignal forwards the signal', async () => {
    const { repo, rpcCalls } = makeClient({});
    await repo.recordSignal('l1', 'save');
    expect(rpcCalls).toEqual([{ fn: 'record_listing_signal', args: { p_listing_id: 'l1', p_signal_type: 'save' } }]);
  });

  it('owner lifecycle RPCs succeed and propagate errors', async () => {
    const { repo, rpcCalls } = makeClient({});
    await repo.updateMyListing('l1', { title: 'New' } as never);
    await repo.pauseMyListing('l1');
    await repo.resumeMyListing('l1');
    await repo.fulfillMyListing('l1');
    await repo.deleteMyListing('l1');
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      'update_my_listing',
      'pause_my_listing',
      'resume_my_listing',
      'fulfill_my_listing',
      'delete_my_listing',
    ]);
    const { repo: bad } = makeClient({
      update_my_listing: fail,
      pause_my_listing: fail,
      resume_my_listing: fail,
      fulfill_my_listing: fail,
      delete_my_listing: fail,
    });
    await expect(bad.updateMyListing('l1', { title: 'x' } as never)).rejects.toMatchObject({ message: 'boom' });
    await expect(bad.pauseMyListing('l1')).rejects.toMatchObject({ message: 'boom' });
    await expect(bad.resumeMyListing('l1')).rejects.toMatchObject({ message: 'boom' });
    await expect(bad.fulfillMyListing('l1')).rejects.toMatchObject({ message: 'boom' });
    await expect(bad.deleteMyListing('l1')).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('SupabaseMarketplaceRepository — external bodies', () => {
  it('searchExternalBodies maps rows and passes world/query', async () => {
    const { repo, rpcCalls } = makeClient({
      search_external_bodies: ok([
        {
          body_id: 'b1',
          slug: 'spca_israel',
          world_slug: 'animals',
          label_he: 'צער בעלי חיים',
          label_en: 'SPCA Israel',
          body_type: 'ngo',
          contact_url: null,
        },
      ]),
    });
    expect(await repo.searchExternalBodies('animals', 'spca')).toEqual([
      {
        bodyId: 'b1',
        slug: 'spca_israel',
        worldSlug: 'animals',
        labelHe: 'צער בעלי חיים',
        labelEn: 'SPCA Israel',
        bodyType: 'ngo',
        contactUrl: null,
      },
    ]);
    expect(rpcCalls[0]).toMatchObject({
      fn: 'search_external_bodies',
      args: { p_world_slug: 'animals', p_query: 'spca', p_limit: 50 },
    });
  });

  it('searchExternalBodies returns [] on error', async () => {
    const { repo } = makeClient({ search_external_bodies: fail });
    expect(await repo.searchExternalBodies('medical')).toEqual([]);
  });

  it('createListing forwards externalBodyId', async () => {
    const { repo, rpcCalls } = makeClient({ create_marketplace_listing: ok('id') });
    await repo.createListing({ kindId: 'k', title: 'Foster', externalBodyId: 'b1' });
    expect(rpcCalls[0]?.args).toMatchObject({ p_external_body_id: 'b1' });
  });

  it('createListing forwards the world subcategory and omits it when none was picked (KC#1296)', async () => {
    const { repo, rpcCalls } = makeClient({ create_marketplace_listing: ok('id') });
    await repo.createListing({ kindId: 'k', title: 'Bookshelf', categoryId: 'cat-books' });
    await repo.createListing({ kindId: 'k', title: 'Chair', categoryId: null });
    expect(rpcCalls[0]?.args).toMatchObject({ p_category_id: 'cat-books' });
    expect(rpcCalls[1]?.args).toMatchObject({ p_category_id: undefined });
  });
});
