// FR-KNOW-004 AC1 (#2478): the adapter passes explicit one-off times in the
// post statement. The database trigger, not a second client write, owns rows.
// These recording-fake tests prove payload/error propagation, not SQL effects.
import { describe, expect, it } from 'vitest';
import { createFakeClient, callsTo, type FakeCall } from '../../__tests__/fakeBaselineClient';
import { ok, fail } from '../../posts/__tests__/cardFixtures';
import { createListing } from '../listingWrites';
import { updateMyListing } from '../listingOwnerActions';

const details = {
  slots: [
    { starts_at: '2030-06-01T10:00:00Z', ends_at: '2030-06-01T11:00:00Z' },
    { starts_at: '2030-06-02T10:00:00Z', ends_at: '2030-06-02T11:00:00Z' },
  ],
  capacity_per_slot: 2,
};
const kind = (slug: string) => ({ id: slug, slug, world_slug: 'knowledge', direction: 'offer', label_he: 'a', label_en: 'a', detail_schema: {} });

describe('one-off knowledge write contract (#2478)', () => {
  it.each(['lesson_offer', 'consulting_hour'])('keeps %s times in the atomic post insert before publish', async (slug) => {
    const { client, calls } = createFakeClient({
      userId: 'u1', tables: { post_kinds: ok([kind(slug)]), posts: ok({ id: 'p1' }) }, rpc: { publish_post: ok(null) },
    });
    expect(await createListing(client, { kindId: slug, title: 'Lesson', cityId: 'c1', details })).toBe('p1');
    expect(callsTo(calls, 'posts').find((c) => c.kind === 'insert')?.payload).toMatchObject({
      world_slug: 'knowledge', kind_id: slug, status: 'draft', details,
    });
    expect(callsTo(calls, 'publish_post')[0]?.args).toEqual({ p_post_id: 'p1' });
    expect(callsTo(calls, 'post_knowledge_slots')).toEqual([]);
  });

  it('never publishes when slot validation rejects the post statement', async () => {
    const { client, calls } = createFakeClient({ userId: 'u1', tables: {
      post_kinds: ok([kind('lesson_offer')]), posts: fail('P0001', 'knowledge_slots_overlap'),
    } });
    await expect(createListing(client, { kindId: 'lesson_offer', title: 'Lesson', cityId: 'c1', details }))
      .rejects.toMatchObject({ reason: 'knowledge_slots_overlap' });
    expect(callsTo(calls, 'publish_post')).toEqual([]);
    expect(callsTo(calls, 'post_knowledge_slots')).toEqual([]);
  });

  it('sends an open offer edit as one post update with no separate slot writes', async () => {
    const { client, calls } = createFakeClient({ tables: {
      posts: (c: FakeCall) => c.kind === 'update' ? ok([{ id: 'p1' }]) : ok({
        post_type: 'standard', world_slug: 'knowledge', direction: 'offer', details: {},
      }),
    } });
    await updateMyListing(client, 'p1', { details });
    expect(callsTo(calls, 'posts').find((c) => c.kind === 'update')?.payload).toMatchObject({ details });
    expect(callsTo(calls, 'post_knowledge_slots')).toEqual([]);
  });

  it('preserves booked-slot refusal from an atomic edit', async () => {
    const { client } = createFakeClient({ tables: {
      posts: (c: FakeCall) => c.kind === 'update' ? fail('P0001', 'knowledge_slot_has_booking') : ok({
        post_type: 'standard', world_slug: 'knowledge', direction: 'offer', details: {},
      }),
    } });
    await expect(updateMyListing(client, 'p1', { details })).rejects.toMatchObject({ reason: 'knowledge_slot_has_booking' });
  });
});
