import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import * as handoffs from '../givingHandoffs';

const ROW = {
  id: 'h1', post_id: 'p1', owner_id: 'o', recipient_id: 'r', machine_id: 'giving_handoff', status: 'reserved', pickup_mode: 'pickup',
  pickup_window_start: null, pickup_window_end: null, confirm_by: '2030-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', confirmed_at: null,
};
const SNAPSHOT = {
  handoffId: 'h1', listingId: 'p1', ownerId: 'o', recipientId: 'r', worldSlug: 'items', status: 'reserved', pickupMode: 'pickup',
  pickupWindowStart: null, pickupWindowEnd: null, confirmBy: '2030-01-01T00:00:00Z', reservedAt: '2026-01-01T00:00:00Z', confirmedAt: null,
};

describe('giving handoffs', () => {
  it('reserves an item with the baseline argument names and the world of the post', async () => {
    const { client, calls } = createFakeClient({ rpc: { reserve_item_giving: ok(ROW) }, tables: { posts: ok({ world_slug: 'items' }) } });
    expect(await handoffs.reserveItemGiving(client, 'p1', 'delivery', 's', 'e')).toEqual(SNAPSHOT);
    expect(callsTo(calls, 'reserve_item_giving')[0]?.args).toEqual({
      p_post_id: 'p1', p_pickup_mode: 'delivery', p_pickup_window_start: 's', p_pickup_window_end: 'e',
    });
  });

  it('claims food, confirms and marks handed over through their RPCs', async () => {
    const { client, calls } = createFakeClient({
      rpc: { claim_food_giving: ok(ROW), confirm_item_handoff: ok(ROW), mark_giving_handed_over: ok({ ...ROW, status: 'handed_over' }) },
      tables: { posts: ok({ world_slug: 'food' }) },
    });
    await handoffs.claimFoodGiving(client, 'p1');
    await handoffs.confirmItemHandoff(client, 'h1');
    expect((await handoffs.markGivingHandedOver(client, 'h1')).status).toBe('handed_over');
    expect(callsTo(calls, 'claim_food_giving')[0]?.args).toMatchObject({ p_post_id: 'p1' });
  });

  it('rates with stars and an optional comment', async () => {
    const { client, calls } = createFakeClient({ rpc: { rate_handoff: ok(null) } });
    await handoffs.rateGivingHandoff(client, 'h1', 5, 'kind');
    expect(callsTo(calls, 'rate_handoff')[0]?.args).toEqual({ p_handoff_id: 'h1', p_stars: 5, p_comment: 'kind' });
  });

  it('reads the caller\'s live handoff of a post, none after a cancel', async () => {
    const { client, calls } = createFakeClient({ tables: { post_handoffs: ok(ROW), posts: ok({ world_slug: 'items' }) } });
    expect(await handoffs.getListingHandoff(client, 'p1')).toEqual(SNAPSHOT);
    expect(callsTo(calls, 'post_handoffs')[0]?.filters).toContainEqual(['in', 'status', ['reserved', 'confirmed', 'handed_over', 'no_show']]);
    const none = createFakeClient({ tables: { post_handoffs: ok(null) } });
    expect(await handoffs.getListingHandoff(none.client, 'p1')).toBeNull();
  });

  it('lists the caller\'s handoffs with the title and the role', async () => {
    const { client } = createFakeClient({
      userId: 'o',
      tables: {
        post_handoffs: ok([
          { ...ROW, posts: { title: 'Sofa', world_slug: 'items' } },
          { ...ROW, id: 'h2', posts: null },
        ]),
      },
    });
    expect(await handoffs.listMyGivingHandoffs(client)).toEqual([
      {
        handoffId: 'h1', listingId: 'p1', title: 'Sofa', worldSlug: 'items', status: 'reserved', role: 'owner',
        pickupWindowStart: null, pickupWindowEnd: null, reservedAt: '2026-01-01T00:00:00Z',
      },
    ]);
    expect(await handoffs.listMyGivingHandoffs(createFakeClient({ userId: null }).client)).toEqual([]);
  });

  it('keeps a refusal reason and reports a missing function', async () => {
    const refused = createFakeClient({ rpc: { reserve_item_giving: fail('P0001', 'item_already_reserved') } });
    await expect(handoffs.reserveItemGiving(refused.client, 'p1')).rejects.toMatchObject({ constructor: BackendRuleError, reason: 'item_already_reserved' });
    const missing = createFakeClient({ rpc: { cancel_giving_handoff: fail('PGRST202', 'nope') } });
    await expect(handoffs.cancelGivingHandoff(missing.client, 'h1')).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('treats an empty answer of a row RPC as a failure', async () => {
    const { client } = createFakeClient({ rpc: { confirm_item_handoff: ok(null) } });
    await expect(handoffs.confirmItemHandoff(client, 'h1')).rejects.toThrow(/returned no row/);
  });
});
