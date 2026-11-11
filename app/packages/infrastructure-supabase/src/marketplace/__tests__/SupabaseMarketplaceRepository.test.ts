import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeCall } from '../../__tests__/fakeBaselineClient';
import { fail, makeCard, ok } from '../../posts/__tests__/cardFixtures';
import { point } from '../../rides/__tests__/placeFixtures';
import { SupabaseMarketplaceRepository } from '../SupabaseMarketplaceRepository';
import { listWorldSubcategories } from '../listWorldSubcategories';
import { searchExternalBodies } from '../mapExternalBody';
import { listingStatusOf, availabilityOf } from '../listingMapping';

const KINDS = [
  { id: 'kind-offer', slug: 'item_offer', world_slug: 'items', direction: 'offer', label_he: 'a', label_en: 'Give', detail_schema: {} },
  { id: 'kind-ride', slug: 'ride_offer', world_slug: 'rides', direction: 'offer', label_he: 'a', label_en: 'Ride', detail_schema: {} },
];

const RIDE_ROW = {
  post_id: 'p2', departs_at: '2030-01-01T07:00:00Z', arrives_at: null, seats: 3, luggage: false, reward_model: 'free', cost_share_ils: null,
  origin_city_id: 'IL-001', origin_street_id: null, origin_junction_id: null, dest_city_id: 'IL-002', dest_street_id: null, dest_junction_id: null,
  meeting_points: [], series_id: null, series_on: null,
};

describe('listing status words', () => {
  it('maps post statuses to the listing vocabulary the screens render', () => {
    expect(['open', 'paused', 'closed_delivered', 'deleted_no_recipient', 'expired', 'hidden_pending_review'].map(listingStatusOf)).toEqual([
      'open', 'cancelled', 'closed', 'closed', 'closed', 'hidden_pending_review',
    ]);
    expect([availabilityOf('paused'), availabilityOf('open')]).toEqual(['paused', 'ongoing']);
  });
});

describe('SupabaseMarketplaceRepository', () => {
  it('lists the kinds of a world with the listing directions', async () => {
    const { client } = createFakeClient({ tables: { post_kinds: ok(KINDS) } });
    expect(await new SupabaseMarketplaceRepository(client).listKindsForWorld('rides')).toEqual([
      { kindId: 'kind-ride', slug: 'ride_offer', labelEn: 'Ride', labelHe: 'a', direction: 'give', detailSchema: {} },
    ]);
  });

  it('builds the detail from post_detail, the world labels and the detail row', async () => {
    const card = makeCard({ id: 'p1', kind_id: 'kind-offer', world_slug: 'items', post_type: 'standard' });
    const { client } = createFakeClient({
      rpc: { post_detail: ok({ post: card, media: [{ id: 'm1', storage_key: 'o/a.jpg' }], comments: [] }) },
      tables: {
        post_kinds: ok(KINDS),
        worlds: ok({ label_he: 'items-he', label_en: 'Items' }),
        posts: ok({ geo_approx: point(34.7, 32.1) }),
      },
    });
    const detail = await new SupabaseMarketplaceRepository(client).getListingDetail('p1');
    expect(detail).toMatchObject({
      listingId: 'p1', ownerId: 'owner-1', worldSlug: 'items', worldLabelEn: 'Items', kindSlug: 'item_offer', direction: 'give',
      title: 'Sofa', summary: 'Three seats', listingStatus: 'open', availabilityStatus: 'ongoing', lat: 32.1, lng: 34.7,
      media: [{ storagePath: 'o/a.jpg', sortOrder: 0 }], feedPostId: 'p1', feedHidden: false,
    });
    expect(detail?.owner).toMatchObject({ userId: 'owner-1', displayName: 'Dana' });
  });

  it('folds a ride\'s details into the form-style document', async () => {
    const card = makeCard({ id: 'p2', kind_id: 'kind-ride', world_slug: 'rides', post_type: 'ride', details: {} });
    const rideRow = RIDE_ROW;
    const { client } = createFakeClient({
      rpc: { post_detail: ok({ post: card, media: [], comments: [] }) },
      tables: {
        post_kinds: ok(KINDS), worlds: ok({ label_he: 'r', label_en: 'Rides' }), posts: ok({ geo_approx: null }),
        post_ride_details: ok(rideRow),
        cities: ok([{ city_id: 'IL-001', name_he: 'Lod', location: point(34.9, 31.9) }, { city_id: 'IL-002', name_he: 'Haifa', location: point(35, 32.8) }]),
        road_junctions: ok([]), streets: ok([]),
      },
    });
    const detail = await new SupabaseMarketplaceRepository(client).getListingDetail('p2');
    expect(detail?.details).toMatchObject({
      departs_at: '2030-01-01T07:00:00Z', seats_available: 3, origin_label: 'Lod', dest_label: 'Haifa', origin_city_id: 'IL-001',
    });
    expect(detail?.details).not.toHaveProperty('ride_series');
  });

  it('marks an occurrence of a recurring ride with its series schedule', async () => {
    const card = makeCard({ id: 'p3', post_type: 'ride', world_slug: 'rides', direction: 'offer' });
    const { client, calls } = createFakeClient({
      rpc: {
        post_detail: ok({ post: card, media: [], comments: [] }),
        ride_occurrence_schedules: ok([
          { post_id: 'p3', series_id: 's1', series_on: '2030-01-07', weekdays: 10, depart_time: '07:30:00', ends_on: null },
        ]),
      },
      tables: {
        post_kinds: ok(KINDS), worlds: ok({ label_he: 'r', label_en: 'Rides' }), posts: ok({ geo_approx: null }),
        post_ride_details: ok({ ...RIDE_ROW, post_id: 'p3', series_id: 's1', series_on: '2030-01-07' }),
        cities: ok([]), road_junctions: ok([]), streets: ok([]),
      },
    });
    const detail = await new SupabaseMarketplaceRepository(client).getListingDetail('p3');
    expect(detail?.details['ride_series']).toEqual({ id: 's1', on: '2030-01-07', weekdays: 10, time: '07:30' });
    expect(callsTo(calls, 'ride_occurrence_schedules')[0]?.args).toEqual({ p_post_ids: ['p3'] });
  });

  it('answers null when the caller cannot read the post', async () => {
    const { client } = createFakeClient({ rpc: { post_detail: ok(null) } });
    expect(await new SupabaseMarketplaceRepository(client).getListingDetail('p1')).toBeNull();
  });

  it('lists similar posts as short entries', async () => {
    const { client, calls } = createFakeClient({
      rpc: { similar_posts: ok([makeCard({ id: 'p9', kind_id: 'kind-offer' })]) },
      tables: { post_kinds: ok(KINDS) },
    });
    expect(await new SupabaseMarketplaceRepository(client).similarListings('p1', 4)).toEqual([
      { listingId: 'p9', title: 'Sofa', worldSlug: 'items', kindSlug: 'item_offer' },
    ]);
    expect(callsTo(calls, 'similar_posts')[0]?.args).toEqual({ p_post_id: 'p1', p_limit: 4 });
  });

  it('opens a chat with the owner anchored to the post and sends the opener', async () => {
    const chatRow = { id: 'chat-1', kind: 'direct', direct_user_a: 'owner-1', direct_user_b: 'me', anchor_post_id: 'p1', created_at: 't', last_message_at: null, moderation_hidden_at: null, support_user_id: null };
    const { client, calls } = createFakeClient({
      userId: 'me',
      rpc: { post_cards: ok([makeCard({ id: 'p1' })]), open_direct_chat: ok(chatRow), send_message: ok({ id: 'm1' }) },
    });
    expect(await new SupabaseMarketplaceRepository(client).startChat('p1', ' hi ')).toBe('chat-1');
    expect(callsTo(calls, 'open_direct_chat')[0]?.args).toEqual({ p_user_id: 'owner-1', p_anchor_post_id: 'p1' });
    expect(callsTo(calls, 'send_message')[0]?.args).toEqual({ p_chat_id: 'chat-1', p_body: 'hi' });
  });

  it('refuses to chat about a post whose owner is masked or unreadable', async () => {
    const { client } = createFakeClient({ userId: 'me', rpc: { post_cards: ok([makeCard({ id: 'p1', owner_id: null })]) } });
    await expect(new SupabaseMarketplaceRepository(client).startChat('p1')).rejects.toMatchObject({ reason: 'post_unavailable' });
  });

  it('pages the caller\'s own listings through the owner-only tab and hands on an opaque cursor', async () => {
    const cursor = { t: '2026-02-01T00:00:00Z', id: 'a' };
    const { client, calls } = createFakeClient({
      userId: 'me',
      tables: { post_kinds: ok(KINDS) },
      rpc: { profile_posts_page: ok([{ card: makeCard({ id: 'a', status: 'paused', kind_id: 'kind-offer' }), next_cursor: cursor }]) },
    });
    const repo = new SupabaseMarketplaceRepository(client);
    const page = await repo.listMyListingsPage(1);
    expect(page.rows[0]).toMatchObject({ listingId: 'a', status: 'cancelled', kindSlug: 'item_offer', feedPostId: 'a' });
    expect(JSON.parse(page.nextCursor ?? '{}')).toEqual(cursor);
    const args = callsTo(calls, 'profile_posts_page')[0]?.args as { p_tab: string; p_statuses: string[]; p_user_id: string };
    expect(args).toMatchObject({ p_user_id: 'me', p_tab: 'mine', p_limit: 1 });
    expect(args.p_statuses).toContain('paused');
    expect(args.p_statuses).not.toContain('draft');
    await repo.listMyListingsPage(1, page.nextCursor);
    expect(callsTo(calls, 'profile_posts_page')[1]?.args).toMatchObject({ p_cursor: cursor });
    expect(calls.some((call) => call.table === 'posts')).toBe(false);
  });

  it('ends the listing pages on a short page and keeps the server\'s refusal', async () => {
    const short = createFakeClient({ userId: 'me', tables: { post_kinds: ok(KINDS) }, rpc: { profile_posts_page: ok([]) } });
    expect(await new SupabaseMarketplaceRepository(short.client).listMyListingsPage(5)).toEqual({ rows: [], nextCursor: null });
    const refused = createFakeClient({ userId: 'me', tables: { post_kinds: ok(KINDS) }, rpc: { profile_posts_page: fail('42501', 'forbidden') } });
    await expect(new SupabaseMarketplaceRepository(refused.client).listMyListingsPage(5)).rejects.not.toBeInstanceOf(BackendUnavailableError);
  });

  it('lists a member\'s open listings through the profile tab', async () => {
    const { client, calls } = createFakeClient({
      rpc: { profile_posts_page: ok([{ card: makeCard({ id: 'a', kind_id: 'kind-offer' }), next_cursor: {} }]) },
      tables: { post_kinds: ok(KINDS) },
    });
    const rows = await new SupabaseMarketplaceRepository(client).listProfileListings('u2', 10);
    expect(rows).toEqual([{ listingId: 'a', worldSlug: 'items', kindSlug: 'item_offer', direction: 'give', status: 'open', title: 'Sofa', summary: 'Three seats' }]);
    expect(callsTo(calls, 'profile_posts_page')[0]?.args).toEqual({ p_user_id: 'u2', p_tab: 'open', p_limit: 10 });
  });

  it('reports a missing catalog or function as BackendUnavailableError', async () => {
    const { client } = createFakeClient({ rpc: { post_detail: fail('PGRST202', 'nope') }, tables: { post_kinds: fail('PGRST205', 'nope') } });
    const repo = new SupabaseMarketplaceRepository(client);
    await expect(repo.getListingDetail('p1')).rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(repo.listKindsForWorld('items')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('world catalogs', () => {
  it('lists the active subcategories of a world in order', async () => {
    const { client, calls } = createFakeClient({ tables: { item_subcategories: ok([{ id: 's1', slug: 'books', label_he: 'b-he', label_en: 'Books' }]) } });
    expect(await listWorldSubcategories(client, 'items')).toEqual([{ categoryId: 's1', slug: 'books', labelHe: 'b-he', labelEn: 'Books' }]);
    const filters = (callsTo(calls, 'item_subcategories')[0] as FakeCall).filters;
    expect(filters).toContainEqual(['eq', 'world_slug', 'items']);
    expect(filters).toContainEqual(['eq', 'is_active', true]);
  });

  it('searches organizations by name, matching the text literally', async () => {
    const { client, calls } = createFakeClient({ tables: { organizations: ok([{ id: 'o1', slug: 'org', name: 'Org', website_url: 'https://o.example' }]) } });
    expect(await searchExternalBodies(client, 'medical', ' 5%_ ')).toEqual([
      { bodyId: 'o1', slug: 'org', worldSlug: 'medical', labelHe: 'Org', labelEn: 'Org', bodyType: 'organization', contactUrl: 'https://o.example' },
    ]);
    expect(callsTo(calls, 'organizations')[0]?.filters).toContainEqual(['ilike', 'name', '%5\\%\\_%']);
  });

  it('reports a missing organizations table', async () => {
    const { client } = createFakeClient({ tables: { organizations: fail('PGRST205', 'nope') } });
    await expect(searchExternalBodies(client, 'medical')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
