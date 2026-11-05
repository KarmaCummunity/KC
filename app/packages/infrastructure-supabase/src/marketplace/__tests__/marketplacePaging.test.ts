import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  browseCursorFrom,
  fetchBrowsePage,
  fetchListingCards,
  fetchMyListingsPage,
  fetchSearchPage,
} from '../marketplacePaging';

type Result = { data: unknown; error: unknown };

function client(rpc: Record<string, Result>, table?: Result) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const inCalls: unknown[] = [];
  const c = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpc[fn] ?? { data: null, error: null };
    },
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.in = (_col: string, ids: unknown) => {
        inCalls.push(ids);
        return Promise.resolve(table ?? { data: [], error: null });
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { c: c as never, rpcCalls, inCalls };
}

const browseRow = (id: string, over: Record<string, unknown> = {}) => ({
  listing_id: id,
  world_slug: 'items',
  kind_slug: 'give_item',
  direction: 'give',
  title: `t-${id}`,
  summary: null,
  urgency_level: 2,
  availability_status: 'available',
  city_id: 'tlv',
  distance_km: null,
  geo: null,
  created_at: '2026-10-01T10:00:00Z',
  sort_key: 1e15,
  ...over,
});

describe('marketplacePaging — browse', () => {
  it('first page sends no cursor and returns a cursor from the last row when full', async () => {
    const rows = [browseRow('a'), browseRow('b', { urgency_level: 1, created_at: '2026-09-01T00:00:00Z' })];
    const { c, rpcCalls } = client({ browse_listings: { data: rows, error: null } });
    const page = await fetchBrowsePage(c, { worldSlug: 'items', limit: 2 });
    expect(rpcCalls[0]?.args).toMatchObject({ p_world_slug: 'items', p_limit: 2, p_offset: 0 });
    expect(rpcCalls[0]?.args.p_cursor_id).toBeUndefined();
    expect(page.rows.map((r) => r.listingId)).toEqual(['a', 'b']);
    expect(page.nextCursor).toEqual({
      sortKey: 1e15,
      urgencyLevel: 1,
      createdAt: '2026-09-01T00:00:00Z',
      listingId: 'b',
    });
  });

  it('passes the keyset cursor and ignores offset when paging', async () => {
    const { c, rpcCalls } = client({ browse_listings: { data: [browseRow('c')], error: null } });
    const cursor = { sortKey: 1200.5, urgencyLevel: 3, createdAt: '2026-01-01T00:00:00Z', listingId: 'b' };
    const page = await fetchBrowsePage(c, { limit: 24, offset: 48, cursor });
    expect(rpcCalls[0]?.args).toMatchObject({
      p_offset: 0,
      p_cursor_sort: 1200.5,
      p_cursor_urgency: 3,
      p_cursor_created_at: '2026-01-01T00:00:00Z',
      p_cursor_id: 'b',
    });
    expect(page.nextCursor).toBeNull(); // short page = last page
  });

  it('forwards the world subcategory and omits it when unset (KC#1102)', async () => {
    const { c, rpcCalls } = client({ browse_listings: { data: [], error: null } });
    await fetchBrowsePage(c, { worldSlug: 'items', categoryId: 'cat-books', radiusKm: 10 });
    await fetchBrowsePage(c, { worldSlug: 'items' });
    expect(rpcCalls[0]?.args).toMatchObject({ p_world_slug: 'items', p_category_id: 'cat-books', p_radius_km: 10 });
    expect(rpcCalls[1]?.args).toMatchObject({ p_category_id: undefined });
  });

  it('returns an empty page on error', async () => {
    const { c } = client({ browse_listings: { data: null, error: { message: 'x' } } });
    expect(await fetchBrowsePage(c, {})).toEqual({ rows: [], nextCursor: null });
  });

  it('browseCursorFrom is null for empty input', () => {
    expect(browseCursorFrom([], 10)).toBeNull();
  });
});

describe('marketplacePaging — search', () => {
  it('maps ids and builds a (score, id) cursor when the page is full', async () => {
    const { c, rpcCalls } = client({
      marketplace_search: {
        data: [
          { listing_id: 'x', rrf_score: 0.05 },
          { listing_id: 'y', rrf_score: 0.032786885246 },
        ],
        error: null,
      },
    });
    const page = await fetchSearchPage(c, 'chair', 'items', 2, { score: 0.06, listingId: 'w' });
    expect(rpcCalls[0]?.args).toMatchObject({ p_query: 'chair', p_world_slug: 'items', p_cursor_score: 0.06, p_cursor_id: 'w' });
    expect(page).toEqual({ rows: ['x', 'y'], nextCursor: { score: 0.032786885246, listingId: 'y' } });
  });

  it('has no next cursor on a short page and is empty on error', async () => {
    const short = client({ marketplace_search: { data: [{ listing_id: 'x', rrf_score: 1 }], error: null } });
    expect((await fetchSearchPage(short.c, 'q', null, 5)).nextCursor).toBeNull();
    const bad = client({ marketplace_search: { data: null, error: { message: 'x' } } });
    expect(await fetchSearchPage(bad.c, 'q', null, 5)).toEqual({ rows: [], nextCursor: null });
  });
});

describe('marketplacePaging — cards', () => {
  it('fetches all cards in one query and keeps the requested order', async () => {
    const { c, inCalls } = client(
      {},
      {
        data: [
          { listing_id: 'b', world_slug: 'food', direction: 'give', title: 'B', summary: null, urgency_level: 1, availability_status: 'a', city_id: null, kind: { slug: 'meal' } },
          { listing_id: 'a', world_slug: 'items', direction: 'request', title: 'A', summary: 's', urgency_level: 2, availability_status: 'a', city_id: 'x', kind: [{ slug: 'give_item' }] },
        ],
        error: null,
      },
    );
    const cards = await fetchListingCards(c, ['a', 'missing', 'b']);
    expect(inCalls).toEqual([['a', 'missing', 'b']]);
    expect(cards.map((r) => [r.listingId, r.kindSlug])).toEqual([
      ['a', 'give_item'],
      ['b', 'meal'],
    ]);
  });

  // #1412 — a card shows its publisher like a feed card does (docs/spec/07 §7.4).
  it('maps the publisher embed, and no publisher when RLS hides the owner', async () => {
    const card = (id: string, publisher: unknown) => ({
      listing_id: id, world_slug: 'rides', direction: 'give', title: id, summary: null, urgency_level: 0,
      availability_status: 'a', city_id: null, kind: null, details: { seats_available: 2 }, publisher,
    });
    const { c } = client({}, {
      data: [
        card('a', { display_name: ' Dana ', avatar_url: 'https://cdn/a.png' }),
        card('b', [{ display_name: null, avatar_url: '' }]),
        card('c', null),
      ],
      error: null,
    });
    const cards = await fetchListingCards(c, ['a', 'b', 'c']);
    expect(cards.map((r) => r.publisher)).toEqual([
      { displayName: 'Dana', avatarUrl: 'https://cdn/a.png' },
      { displayName: null, avatarUrl: null },
      null,
    ]);
    expect(cards[0]?.ride?.seats).toBe(2);
  });

  it('skips the query for no ids and returns [] on error', async () => {
    const none = client({});
    expect(await fetchListingCards(none.c, [])).toEqual([]);
    expect(none.inCalls).toEqual([]);
    const bad = client({}, { data: null, error: { message: 'x' } });
    expect(await fetchListingCards(bad.c, ['a'])).toEqual([]);
  });
});

describe('marketplacePaging — my listings', () => {
  const my = (id: string, updated: string) => ({
    listing_id: id, world_slug: 'items', kind_slug: 'k', direction: 'give', status: 'open',
    title: id, summary: null, urgency_level: 1, availability_status: 'a', updated_at: updated,
  });

  it('builds an (updatedAt, id) cursor and forwards it', async () => {
    const { c, rpcCalls } = client({ list_my_listings: { data: [my('a', '2026-02-01T00:00:00Z'), my('b', '2026-01-01T00:00:00Z')], error: null } });
    const page = await fetchMyListingsPage(c, 2, { updatedAt: '2026-03-01T00:00:00Z', listingId: 'z' }, 10);
    expect(rpcCalls[0]?.args).toMatchObject({ p_limit: 2, p_offset: 0, p_cursor_updated_at: '2026-03-01T00:00:00Z', p_cursor_id: 'z' });
    expect(page.nextCursor).toEqual({ updatedAt: '2026-01-01T00:00:00Z', listingId: 'b' });
  });

  it('uses offset only without a cursor; empty on error', async () => {
    const { c, rpcCalls } = client({ list_my_listings: { data: null, error: { message: 'x' } } });
    expect(await fetchMyListingsPage(c, 5, null, 10)).toEqual({ rows: [], nextCursor: null });
    expect(rpcCalls[0]?.args).toMatchObject({ p_offset: 10 });
  });
});

// G1 step 6a-5h (D-214): a post-owned listing's card reads its post; every other shape reads the
// listing. Both syncs keep the fields equal, so the card is the same for every shape.
describe('marketplacePaging — cards by shape', () => {
  const dana = { display_name: 'Dana', avatar_url: null };
  const listingRow = (id: string, over: Record<string, unknown> = {}) => ({
    listing_id: id, world_slug: 'rides', direction: 'give', title: `title ${id}`, summary: 'from the station',
    urgency_level: 2, availability_status: 'scheduled', city_id: 'tel-aviv',
    details: { origin_label: 'A', dest_label: 'B', seats_available: 3 }, kind: { slug: 'ride_offer' },
    publisher: dana, origin: 'native', legacy_post_id: null, post: null, ...over,
  });
  // The post as both syncs leave it: the listing's values in the post's words.
  const syncedPost = { world_slug: 'rides', direction: 'offer', urgency_level: 2, availability_status: 'scheduled',
    details: { origin_label: 'A', dest_label: 'B', seats_available: 3 }, kind: [{ slug: 'ride_offer' }], publisher: [dana] };
  const cardsOf = async (rows: unknown[], ids: string[]) => fetchListingCards(client({}, { data: rows, error: null }).c, ids);
  /** The card the listing alone gives (the pre-6a-5h read). */
  const listingOnly = async (row: Record<string, unknown>) =>
    (await cardsOf([{ ...row, origin: 'native', legacy_post_id: null, post: null }], [row.listing_id as string]))[0];

  it('gives a post-owned listing the same card from its post as from the listing', async () => {
    const owned = listingRow('owned', { legacy_post_id: 'p1', post: syncedPost });
    const [card] = await cardsOf([owned], ['owned']);
    expect(card).toEqual(await listingOnly(owned));
    expect(card?.direction).toBe('give'); // the post's `offer`
  });

  it('keeps title, summary and city from the listing (a 0554-backfilled post may differ there)', async () => {
    const owned = listingRow('backfilled', { title: 'x'.repeat(100), city_id: null, legacy_post_id: 'p2', post: syncedPost });
    const [card] = await cardsOf([owned], ['backfilled']);
    expect(card).toEqual(await listingOnly(owned));
    expect(card?.title).toBe('x'.repeat(100));
  });

  it('reads the post for the fields it owns', async () => {
    const post = { ...syncedPost, world_slug: 'food', direction: 'request', urgency_level: 3,
      availability_status: 'immediate', kind: { slug: 'request_food' }, publisher: { display_name: 'Post owner', avatar_url: 'u' } };
    const [card] = await cardsOf([listingRow('o', { legacy_post_id: 'p3', post })], ['o']);
    expect(card).toMatchObject({ worldSlug: 'food', kindSlug: 'request_food', direction: 'request', urgencyLevel: 3,
      availabilityStatus: 'immediate', ride: null, publisher: { displayName: 'Post owner', avatarUrl: 'u' } });
  });

  it('reads the listing for a mirror, an items post, and a post hidden by RLS', async () => {
    const other = { ...syncedPost, world_slug: 'food', kind: { slug: 'other' }, publisher: { display_name: 'Other', avatar_url: null } };
    const mirror = listingRow('mirror', { post: other });
    const items = listingRow('items', { world_slug: 'items', origin: 'post', legacy_post_id: 'p4', post: other });
    const hidden = listingRow('hidden', { legacy_post_id: 'p5', post: null });
    const cards = await cardsOf([mirror, items, hidden], ['mirror', 'items', 'hidden']);
    expect(cards).toEqual([await listingOnly(mirror), await listingOnly(items), await listingOnly(hidden)]);
  });
});
