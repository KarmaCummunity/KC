import { describe, expect, it } from 'vitest';
import { PostError, type CreatePostInput } from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeCall, type FakeClientConfig } from '../../__tests__/fakeBaselineClient';
import { adminRemovePost, createPost, deletePost, updatePost } from '../postWriteMethods';
import { KIND_ROWS, SUBCATEGORY_ROWS, fail, ok } from './cardFixtures';

const INPUT: CreatePostInput = {
  ownerId: 'u-owner',
  type: 'Give',
  visibility: 'Public',
  title: 'Sofa',
  description: 'Three seats',
  category: 'Furniture',
  address: { city: 'IL-001', cityName: 'Tel Aviv', street: 'Herzl', streetNumber: '5' },
  locationDisplayLevel: 'CityAndStreet',
  itemCondition: 'Good',
  urgency: null,
  estimatedValue: 120,
  mediaAssets: [{ path: 'u-owner/b/0.jpg', mimeType: 'image/jpeg', sizeBytes: 900 }],
};

function setup(overrides: FakeClientConfig = {}) {
  return createFakeClient({
    userId: 'u-owner',
    tables: {
      item_subcategories: ok(SUBCATEGORY_ROWS),
      post_kinds: ok(KIND_ROWS),
      posts: (call: FakeCall) => ok(call.kind === 'insert' ? { id: 'new-1' } : null),
      post_private_locations: ok(null),
      post_media: ok(null),
      ...overrides.tables,
    },
    rpc: { publish_post: ok(null), upsert_post_actor_identity: ok(null), ...overrides.rpc },
  });
}

describe('createPost', () => {
  it('writes a draft, completes it and publishes it', async () => {
    const { client, calls } = setup();

    const id = await createPost(client, INPUT);

    expect(id).toBe('new-1');
    const insert = callsTo(calls, 'posts').find((call) => call.kind === 'insert');
    expect(insert?.payload).toEqual({
      owner_id: 'u-owner',
      world_slug: 'items',
      kind_id: 'kind-offer',
      post_type: 'standard',
      direction: 'offer',
      status: 'draft',
      visibility: 'Public',
      title: 'Sofa',
      description: 'Three seats',
      item_subcategory_id: 'sub-furniture',
      details: { item_condition: 'Good', estimated_value: 120 },
      city_id: 'IL-001',
      location_display_level: 'CityAndStreet',
    });
    expect(callsTo(calls, 'post_private_locations')[0]?.payload).toEqual({
      post_id: 'new-1',
      street: 'Herzl',
      street_number: '5',
    });
    expect(callsTo(calls, 'post_media')[0]?.payload).toEqual([
      expect.objectContaining({ post_id: 'new-1', owner_id: 'u-owner', storage_key: 'u-owner/b/0.jpg', ordinal: 0 }),
    ]);
    expect(callsTo(calls, 'publish_post')[0]?.args).toEqual({ p_post_id: 'new-1' });
  });

  it('stores the urgency note of a request and skips the address row without a street', async () => {
    const { client, calls } = setup();

    await createPost(client, {
      ...INPUT,
      type: 'Request',
      itemCondition: null,
      estimatedValue: null,
      urgency: 'by Friday',
      address: { ...INPUT.address, street: ' ', streetNumber: '' },
      mediaAssets: [],
    });

    const insert = callsTo(calls, 'posts').find((call) => call.kind === 'insert');
    expect(insert?.payload).toMatchObject({ direction: 'request', kind_id: 'kind-request', details: { urgency_note: 'by Friday' } });
    expect(callsTo(calls, 'post_private_locations')).toHaveLength(0);
    expect(callsTo(calls, 'post_media')).toHaveLength(0);
  });

  it('records "hide me from the counterparty" before publishing', async () => {
    const { client, calls } = setup();

    await createPost(client, { ...INPUT, hideFromCounterparty: true });

    const order = calls.filter((c) => c.kind === 'rpc').map((c) => c.fn);
    expect(order).toEqual(['upsert_post_actor_identity', 'publish_post']);
    expect(callsTo(calls, 'upsert_post_actor_identity')[0]?.args).toEqual({
      p_post_id: 'new-1',
      p_surface_visibility: 'Public',
      p_hide_from_counterparty: true,
    });
  });

  it('removes the draft and reports the stable reason when publishing is refused', async () => {
    const { client, calls } = setup({ rpc: { publish_post: fail('P0001', 'post_limit_exceeded') } });

    await expect(createPost(client, INPUT)).rejects.toMatchObject({ code: 'active_post_limit_exceeded' });

    const cleanup = callsTo(calls, 'posts').find((call) => call.kind === 'delete');
    expect(cleanup?.filters).toContainEqual(['eq', 'id', 'new-1']);
  });

  it('removes the draft when the photos cannot be recorded', async () => {
    const { client, calls } = setup({ tables: { post_media: fail('23505', 'duplicate key') } });

    await expect(createPost(client, INPUT)).rejects.toBeInstanceOf(Error);

    expect(callsTo(calls, 'posts').some((call) => call.kind === 'delete')).toBe(true);
    expect(callsTo(calls, 'publish_post')).toHaveLength(0);
  });

  it('is a missing backend object, not a half-made post, when the catalog is empty (degrade rule)', async () => {
    const { client, calls } = setup({ tables: { item_subcategories: ok([]), post_kinds: ok([]) } });

    await expect(createPost(client, INPUT)).rejects.toBeInstanceOf(BackendUnavailableError);

    expect(callsTo(calls, 'posts').some((call) => call.kind === 'insert' || call.kind === 'delete')).toBe(false);
  });

  it('maps a refused insert by its constraint', async () => {
    const { client } = setup({
      tables: { posts: fail('23503', 'insert violates foreign key constraint posts_city_id_fkey') },
    });
    await expect(createPost(client, INPUT)).rejects.toMatchObject({ code: 'city_not_found' });
  });
});

describe('updatePost', () => {
  it('updates the content columns and merges the details', async () => {
    const { client, calls } = createFakeClient({
      userId: 'u-owner',
      tables: {
        item_subcategories: ok(SUBCATEGORY_ROWS),
        post_kinds: ok(KIND_ROWS),
        posts: (call: FakeCall) =>
          ok(call.kind === 'update' ? [{ id: 'p1' }] : { details: { item_condition: 'Good', estimated_value: 120 } }),
        post_private_locations: ok(null),
      },
    });

    await updatePost(client, 'p1', {
      title: 'New title',
      category: 'Books',
      itemCondition: 'Fair',
      address: { city: 'IL-002', cityName: 'Haifa', street: 'Allenby', streetNumber: '9' },
    });

    const update = callsTo(calls, 'posts').find((call) => call.kind === 'update');
    expect(update?.payload).toEqual({
      title: 'New title',
      item_subcategory_id: 'sub-books',
      city_id: 'IL-002',
      details: { item_condition: 'Fair', estimated_value: 120 },
    });
    expect(update?.filters).toContainEqual(['eq', 'id', 'p1']);
    expect(callsTo(calls, 'post_private_locations')[0]?.payload).toMatchObject({ post_id: 'p1', street: 'Allenby' });
  });

  it('says the post is not open when row-level security matched no row', async () => {
    const { client } = createFakeClient({ tables: { posts: ok([]) } });

    await expect(updatePost(client, 'p1', { title: 'x' })).rejects.toMatchObject({ code: 'post_not_open' });
  });

  it('does nothing when the patch is empty', async () => {
    const { client, calls } = createFakeClient();
    await updatePost(client, 'p1', {});
    expect(calls).toHaveLength(0);
  });

  it('replaces the photos of the signed-in owner', async () => {
    const { client, calls } = createFakeClient({
      userId: 'u-owner',
      tables: { post_media: (call: FakeCall) => ok(call.kind === 'select' ? [] : null) },
    });

    await updatePost(client, 'p1', { mediaAssets: [{ path: 'u-owner/b/1.jpg', mimeType: 'image/jpeg', sizeBytes: 5 }] });

    const insert = callsTo(calls, 'post_media').find((call) => call.kind === 'insert');
    expect(insert?.payload).toEqual([expect.objectContaining({ owner_id: 'u-owner', storage_key: 'u-owner/b/1.jpg', ordinal: 0 })]);
  });
});

describe('deletePost / adminRemovePost', () => {
  it('deletes through the RPC', async () => {
    const { client, calls } = createFakeClient({ rpc: { delete_post: ok(null) } });
    await deletePost(client, 'p1');
    expect(callsTo(calls, 'delete_post')[0]?.args).toEqual({ p_post_id: 'p1' });
  });

  it('reports a post that cannot be deleted in its status', async () => {
    const { client } = createFakeClient({ rpc: { delete_post: fail('P0001', 'listing_wrong_status') } });
    await expect(deletePost(client, 'p1')).rejects.toMatchObject({ code: 'post_owner_delete_forbidden' });
  });

  it('reports a post that is not found', async () => {
    const { client } = createFakeClient({ rpc: { delete_post: fail('P0001', 'post_not_found') } });
    await expect(deletePost(client, 'p1')).rejects.toBeInstanceOf(PostError);
  });

  it('removes a post as staff, and reports a caller without the role as forbidden', async () => {
    const allowed = createFakeClient({ rpc: { admin_remove_post: ok(null) } });
    await adminRemovePost(allowed.client, 'p1');
    expect(callsTo(allowed.calls, 'admin_remove_post')[0]?.args).toEqual({ p_post_id: 'p1' });

    const refused = createFakeClient({ rpc: { admin_remove_post: fail('42501', 'forbidden') } });
    await expect(adminRemovePost(refused.client, 'p1')).rejects.toMatchObject({ code: 'forbidden' });
  });
});
