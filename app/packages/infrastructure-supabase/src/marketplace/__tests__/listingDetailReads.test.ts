// NFR-PERF-005 — how many reads, and in what order, one listing detail costs.
import { describe, expect, it } from 'vitest';
import { callsTo, createFakeClient, type FakeCall } from '../../__tests__/fakeBaselineClient';
import { makeCard, ok, pageTables } from '../../posts/__tests__/cardFixtures';
import { SupabasePostRepository } from '../../posts/SupabasePostRepository';
import { fetchListingDetail } from '../mapListingDetail';
import { SupabaseMarketplaceRepository } from '../SupabaseMarketplaceRepository';
import { WARM_LISTING_DETAIL_TTL_MS, readListingDetail, warmListingDetail } from '../listingDetailWarmup';

const WORLDS = [{ slug: 'items', label_he: 'items-he', label_en: 'Items' }, { slug: 'food', label_he: 'food-he', label_en: 'Food' }];

function setup(cardOverrides: Parameters<typeof makeCard>[0] = {}) {
  const card = makeCard({ id: 'p1', world_slug: 'food', direction: 'request', post_type: 'standard', ...cardOverrides });
  return createFakeClient({
    rpc: { post_detail: ok({ post: card, media: [], comments: [] }), post_cards: ok([card]) },
    // `posts` answers the listing's one-row geo read with an object and the card extras with a list.
    tables: pageTables({
      worlds: ok(WORLDS),
      posts: (call: FakeCall) => ok(call.single ? { geo_approx: null } : []),
      post_media: ok([]),
      post_private_locations: ok(null),
    }),
  });
}

describe('fetchListingDetail read order', () => {
  it('starts the id-only reads together with post_detail, before it answers', async () => {
    const { client, calls } = setup();
    let release: () => void = () => undefined;
    const realRpc = client.rpc.bind(client) as unknown as (fn: string, args?: unknown) => Promise<unknown>;
    (client as { rpc: unknown }).rpc = (fn: string, args?: unknown) =>
      fn === 'post_detail' ? new Promise((resolve) => { release = () => resolve(realRpc(fn, args)); }) : realRpc(fn, args);

    const pending = fetchListingDetail(client, 'p1');
    await Promise.resolve();
    expect(callsTo(calls, 'posts')).toHaveLength(1);
    expect(callsTo(calls, 'post_kinds')).toHaveLength(1);
    expect(callsTo(calls, 'worlds')).toHaveLength(1);

    release();
    expect((await pending)?.worldLabelEn).toBe('Food');
  });

  it('reads the world labels once per client, however many details are opened', async () => {
    const { client, calls } = setup();
    await fetchListingDetail(client, 'p1');
    await fetchListingDetail(client, 'p1');
    expect(callsTo(calls, 'worlds')).toHaveLength(1);
    expect(callsTo(calls, 'post_kinds')).toHaveLength(1);
  });
});

describe('listing detail shared with the post read', () => {
  it('lets the listing screen take the read the post read started', async () => {
    const { client, calls } = setup();
    await new SupabasePostRepository(client).findById('p1');
    // The listing read was started by the post read itself, before the listing screen asked.
    expect(callsTo(calls, 'post_detail')).toHaveLength(1);
    const detail = await new SupabaseMarketplaceRepository(client).getListingDetail('p1');
    expect(detail?.listingId).toBe('p1');
    expect(callsTo(calls, 'post_detail')).toHaveLength(1);
  });

  it('does not start a listing read for a post of the items world', async () => {
    const { client, calls } = setup({ world_slug: 'items' });
    await new SupabasePostRepository(client).findById('p1');
    expect(callsTo(calls, 'post_detail')).toHaveLength(0);
  });

  it('hands a warmed read out once, then reads afresh', async () => {
    const { client, calls } = setup();
    warmListingDetail(client, 'p1', 1_000);
    await readListingDetail(client, 'p1', 1_001);
    await readListingDetail(client, 'p1', 1_002);
    expect(callsTo(calls, 'post_detail')).toHaveLength(2);
  });

  it('ignores a warmed read older than the window', async () => {
    const { client, calls } = setup();
    warmListingDetail(client, 'p1', 1_000);
    await readListingDetail(client, 'p1', 1_000 + WARM_LISTING_DETAIL_TTL_MS);
    expect(callsTo(calls, 'post_detail')).toHaveLength(2);
  });
});
