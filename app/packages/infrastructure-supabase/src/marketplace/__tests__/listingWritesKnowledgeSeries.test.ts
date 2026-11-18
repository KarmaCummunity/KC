// FR-KNOW-003 AC2 / FR-KNOW-004 AC1 (#2479): publishing a weekly lesson offer starts its series
// between the draft and the publish, so a refused schedule leaves no offer behind.
import { describe, expect, it } from 'vitest';
import { BackendRuleError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeCall } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { createListing } from '../listingWrites';

const KINDS = [
  { id: 'k-lesson', slug: 'lesson_offer', world_slug: 'knowledge', direction: 'offer', label_he: 'a', label_en: 'a', detail_schema: {} },
];
const WEEKLY = {
  topic: 'algebra', modality: 'video', capacity_per_slot: 2, schedule: 'weekly',
  series_weekdays: [0, 2], series_time: '18:00', series_duration_minutes: 60,
};

function setup(startSeries: ReturnType<typeof ok>) {
  return createFakeClient({
    userId: 'u1',
    tables: { post_kinds: ok(KINDS), post_media: ok(null), posts: (c: FakeCall) => ok(c.kind === 'insert' ? { id: 'new-1' } : null) },
    rpc: { publish_post: ok(null), start_knowledge_slot_series: startSeries },
  });
}

const insertedDetails = (calls: FakeCall[]) =>
  (calls.find((c) => c.table === 'posts' && c.kind === 'insert')?.payload as { details: Record<string, unknown> }).details;

describe('createListing — weekly lesson offer', () => {
  it('stores the offer without the schedule inputs, starts the series, then publishes', async () => {
    const { client, calls } = setup(ok('series-1'));
    expect(await createListing(client, { kindId: 'k-lesson', title: 'Algebra', cityId: 'IL-001', details: WEEKLY })).toBe('new-1');
    expect(insertedDetails(calls)).toEqual({ topic: 'algebra', modality: 'video', capacity_per_slot: 2 });
    expect(callsTo(calls, 'start_knowledge_slot_series')[0]?.args).toEqual({
      p_post_id: 'new-1', p_weekdays: 5, p_start_time: '18:00', p_duration_minutes: 60, p_capacity: 2,
    });
    const order = calls.filter((c) => c.kind === 'rpc').map((c) => c.fn);
    expect(order).toEqual(['start_knowledge_slot_series', 'publish_post']);
  });

  it('removes the draft when the server refuses the schedule', async () => {
    const { client, calls } = setup(fail('P0001', 'knowledge_series_no_occurrence'));
    await expect(createListing(client, { kindId: 'k-lesson', title: 'Algebra', cityId: 'IL-001', details: WEEKLY }))
      .rejects.toBeInstanceOf(BackendRuleError);
    expect(callsTo(calls, 'publish_post')).toHaveLength(0);
    expect(calls.some((c) => c.table === 'posts' && c.kind === 'delete')).toBe(true);
  });

  it('keeps a one-off lesson offer a plain post without a series', async () => {
    const { client, calls } = setup(ok('series-1'));
    await createListing(client, { kindId: 'k-lesson', title: 'Algebra', cityId: 'IL-001', details: { topic: 'algebra', schedule: 'one_off' } });
    expect(insertedDetails(calls)).toEqual({ topic: 'algebra' });
    expect(callsTo(calls, 'start_knowledge_slot_series')).toHaveLength(0);
  });
});
