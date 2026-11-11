import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError, ValidationError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeCall } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { createListing } from '../listingWrites';
import * as owner from '../listingOwnerActions';

const KINDS = [
  { id: 'k-ride', slug: 'ride_offer', world_slug: 'rides', direction: 'offer', label_he: 'a', label_en: 'a', detail_schema: {} },
  { id: 'k-event', slug: 'event', world_slug: 'time', direction: 'offer', label_he: 'a', label_en: 'a', detail_schema: {} },
  { id: 'k-food', slug: 'food_offer', world_slug: 'food', direction: 'offer', label_he: 'a', label_en: 'a', detail_schema: {} },
  { id: 'k-item', slug: 'item_offer', world_slug: 'items', direction: 'offer', label_he: 'a', label_en: 'a', detail_schema: {} },
  { id: 'k-either', slug: 'either_kind', world_slug: 'items', direction: 'either', label_he: 'a', label_en: 'a', detail_schema: {} },
];
const RIDE_FORM = {
  origin_place_kind: 'city', origin_place_id: 'IL-001', origin_label: 'a', origin_lat: 1, origin_lng: 2, origin_city_id: 'IL-001',
  dest_place_kind: 'city', dest_place_id: 'IL-002', dest_label: 'b', dest_lat: 1, dest_lng: 2,
  departs_at: '2030-01-01T07:00:00Z', seats_available: 2, pickup_note: 'x',
};

function setup(rpc: Record<string, ReturnType<typeof ok>> = {}) {
  return createFakeClient({
    userId: 'u1',
    tables: { post_kinds: ok(KINDS), post_media: ok(null), posts: (c: FakeCall) => ok(c.kind === 'insert' ? { id: 'new-1' } : null) },
    rpc: { create_post_with_details: ok('post-1'), publish_post: ok(null), set_post_organization: ok(null), ...rpc },
  });
}

describe('createListing', () => {
  it('creates a ride with its detail columns and the origin city', async () => {
    const { client, calls } = setup();
    const id = await createListing(client, { kindId: 'k-ride', title: 'Lod to Haifa', summary: 'note', details: RIDE_FORM });
    expect(id).toBe('post-1');
    const args = callsTo(calls, 'create_post_with_details')[0]?.args as { p_post: Record<string, unknown>; p_details: Record<string, unknown> };
    expect(args.p_post).toMatchObject({ world_slug: 'rides', kind_id: 'k-ride', post_type: 'ride', direction: 'offer', city_id: 'IL-001', details: { pickup_note: 'x' } });
    expect(args.p_details).toMatchObject({ origin_city_id: 'IL-001', dest_city_id: 'IL-002', seats: 2, departs_at: '2030-01-01T07:00:00Z' });
  });

  it('creates an organization event and attaches it to its organization', async () => {
    const { client, calls } = setup();
    await createListing(client, { kindId: 'k-event', title: 'Cleanup', cityId: 'IL-001', details: { starts_at: 's', ends_at: 'e', org_id: 'org-1' } });
    const args = callsTo(calls, 'create_post_with_details')[0]?.args as { p_post: Record<string, unknown> };
    expect(args.p_post).toMatchObject({ post_type: 'event', world_slug: 'time' });
    expect(callsTo(calls, 'set_post_organization')[0]?.args).toEqual({ p_post_id: 'post-1', p_org_id: 'org-1' });
  });

  it('creates a food offer with the food columns and records its photos', async () => {
    const { client, calls } = setup();
    await createListing(client, {
      kindId: 'k-food', title: 'Soup', cityId: 'IL-001', categoryId: 'sub-1', mediaPaths: ['u1/b/0.jpg'], details: { expires_at: 'x', kosher: 'yes' },
    });
    const args = callsTo(calls, 'create_post_with_details')[0]?.args as { p_post: Record<string, unknown>; p_details: Record<string, unknown> };
    expect(args.p_post).toMatchObject({ item_subcategory_id: 'sub-1', direction: 'offer' });
    expect(args.p_details).toMatchObject({ expires_at: 'x', kosher: true });
    expect(callsTo(calls, 'post_media')[0]?.payload).toEqual([
      { post_id: 'post-1', owner_id: 'u1', kind: 'image', storage_bucket: 'post-images', storage_key: 'u1/b/0.jpg', ordinal: 0, mime_type: 'image/jpeg', size_bytes: 1 },
    ]);
  });

  it('writes a plain post as a draft, adds its photos and publishes it; the direction of an either-kind comes from the form', async () => {
    const { client, calls } = setup();
    expect(await createListing(client, { kindId: 'k-either', direction: 'request', title: 'Chair', cityId: 'IL-001', mediaPaths: ['u1/b/0.jpg'], details: { a: 1 } })).toBe('new-1');
    const insert = callsTo(calls, 'posts').find((c) => c.kind === 'insert');
    expect(insert?.payload).toMatchObject({ owner_id: 'u1', world_slug: 'items', direction: 'request', post_type: 'standard', status: 'draft', details: { a: 1 } });
    expect(callsTo(calls, 'publish_post')[0]?.args).toEqual({ p_post_id: 'new-1' });
  });

  it('removes the draft when completing it fails', async () => {
    const { client, calls } = setup({ publish_post: fail('P0001', 'post_limit_exceeded') });
    await expect(createListing(client, { kindId: 'k-item', title: 'Chair', cityId: 'IL-001' })).rejects.toBeInstanceOf(BackendRuleError);
    expect(callsTo(calls, 'posts').some((c) => c.kind === 'delete')).toBe(true);
  });

  it('refuses a ride without official places or a listing without a city', async () => {
    const { client } = setup();
    await expect(createListing(client, { kindId: 'k-ride', title: 't', details: {} })).rejects.toBeInstanceOf(ValidationError);
    await expect(createListing(client, { kindId: 'k-item', title: 't' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createListing(client, { kindId: 'nope', title: 't', cityId: 'c' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps the server\'s refusal and reports a missing function', async () => {
    const refused = setup({ create_post_with_details: fail('P0001', 'declaration_required') });
    await expect(createListing(refused.client, { kindId: 'k-ride', title: 't', details: RIDE_FORM })).rejects.toMatchObject({ reason: 'declaration_required' });
    const missing = setup({ create_post_with_details: fail('PGRST202', 'nope') });
    await expect(createListing(missing.client, { kindId: 'k-ride', title: 't', details: RIDE_FORM })).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('listing owner actions', () => {
  it('runs each status move through its post RPC', async () => {
    const { client, calls } = createFakeClient({ rpc: { pause_post: ok(null), resume_post: ok(null), close_post_without_recipient: ok(null), delete_post: ok(null) } });
    for (const action of ['pause', 'resume', 'fulfill', 'delete'] as const) await owner.runOwnerAction(client, action, 'p1');
    expect(calls.map((c) => c.fn)).toEqual(['pause_post', 'resume_post', 'close_post_without_recipient', 'delete_post']);
    expect(calls[0]?.args).toEqual({ p_post_id: 'p1' });
  });

  it('keeps a lifecycle refusal', async () => {
    const { client } = createFakeClient({ rpc: { pause_post: fail('P0001', 'listing_has_active_handoff') } });
    await expect(owner.runOwnerAction(client, 'pause', 'p1')).rejects.toMatchObject({ reason: 'listing_has_active_handoff' });
  });

  it('edits the post content and the ride row of a ride', async () => {
    const { client, calls } = createFakeClient({
      tables: {
        posts: (c: FakeCall) => (c.kind === 'update' ? ok([{ id: 'p1' }]) : ok({ post_type: 'ride', world_slug: 'rides', direction: 'offer', details: {} })),
        post_ride_details: ok([{ post_id: 'p1' }]),
      },
    });
    await owner.updateMyListing(client, 'p1', { title: 'New', summary: 'S', urgencyLevel: 3, details: RIDE_FORM });
    const post = callsTo(calls, 'posts').find((c) => c.kind === 'update');
    expect(post?.payload).toMatchObject({ title: 'New', description: 'S', urgency_level: 3, city_id: 'IL-001', details: { pickup_note: 'x' } });
    expect(callsTo(calls, 'post_ride_details')[0]?.payload).toMatchObject({ seats: 2, origin_city_id: 'IL-001' });
  });

  it('refuses an edit the row policy let no row through', async () => {
    const { client } = createFakeClient({
      tables: { posts: (c: FakeCall) => (c.kind === 'update' ? ok([]) : ok({ post_type: 'standard', world_slug: 'items', direction: 'offer', details: {} })) },
    });
    await expect(owner.updateMyListing(client, 'p1', { title: 'x' })).rejects.toMatchObject({ reason: 'listing_wrong_status' });
  });

  it('adds only photos the post does not hold yet, after the last one, five at most', async () => {
    const { client, calls } = createFakeClient({
      userId: 'u1',
      tables: { post_media: (c: FakeCall) => (c.kind === 'insert' ? ok(null) : ok([{ storage_key: 'u1/a.jpg', ordinal: 2 }])) },
    });
    expect(await owner.addMyListingMedia(client, 'p1', ['u1/a.jpg', 'u1/b.jpg', 'u1/c.jpg', 'u1/d.jpg', 'u1/e.jpg'])).toBe(2);
    const rows = callsTo(calls, 'post_media').find((c) => c.kind === 'insert')?.payload as { storage_key: string; ordinal: number }[];
    expect(rows.map((r) => [r.storage_key, r.ordinal])).toEqual([['u1/b.jpg', 3], ['u1/c.jpg', 4]]);
  });
});
