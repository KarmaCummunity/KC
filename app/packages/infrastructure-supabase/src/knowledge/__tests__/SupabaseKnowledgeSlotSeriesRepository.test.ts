// FR-KNOW-004 AC1 (#2479): the weekly series of a recurring lesson offer.
import { describe, expect, it } from 'vitest';
import { BackendRuleError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import {
  SupabaseKnowledgeSlotSeriesRepository,
  startKnowledgeSlotSeries,
} from '../SupabaseKnowledgeSlotSeriesRepository';

const ROW = {
  post_id: 'p1', weekdays: 5, start_time: '18:00:00', duration_minutes: 90, capacity: 2,
  ends_on: '2030-03-01', status: 'paused',
};

describe('SupabaseKnowledgeSlotSeriesRepository', () => {
  it('reads the series of an offer: weekdays from the bit set, HH:mm time', async () => {
    const { client, calls } = createFakeClient({ tables: { knowledge_slot_series: ok(ROW) } });
    expect(await new SupabaseKnowledgeSlotSeriesRepository(client).getForPost('p1')).toEqual({
      postId: 'p1', weekdays: [0, 2], startTime: '18:00', durationMinutes: 90, capacity: 2, endsOn: '2030-03-01', status: 'paused',
    });
    expect(callsTo(calls, 'knowledge_slot_series')[0]?.filters).toContainEqual(['eq', 'post_id', 'p1']);
  });

  it('is null for an offer without a series, and for a state the app does not know', async () => {
    const none = createFakeClient({ tables: { knowledge_slot_series: ok(null) } });
    expect(await new SupabaseKnowledgeSlotSeriesRepository(none.client).getForPost('p1')).toBeNull();
    const newer = createFakeClient({ tables: { knowledge_slot_series: ok({ ...ROW, status: 'archived' }) } });
    expect(await new SupabaseKnowledgeSlotSeriesRepository(newer.client).getForPost('p1')).toBeNull();
  });

  it('moves the series and keeps the server reason of a refusal', async () => {
    const { client, calls } = createFakeClient({ rpc: { set_knowledge_slot_series_status: ok(null) } });
    await new SupabaseKnowledgeSlotSeriesRepository(client).setStatus('p1', 'ended');
    expect(callsTo(calls, 'set_knowledge_slot_series_status')[0]?.args).toEqual({ p_post_id: 'p1', p_status: 'ended' });
    const refused = createFakeClient({ rpc: { set_knowledge_slot_series_status: fail('P0001', 'illegal_transition') } });
    await expect(new SupabaseKnowledgeSlotSeriesRepository(refused.client).setStatus('p1', 'active')).rejects.toBeInstanceOf(BackendRuleError);
  });

  it('starts a series with the server bit set and Israel time', async () => {
    const { client, calls } = createFakeClient({ rpc: { start_knowledge_slot_series: ok('s1') } });
    await startKnowledgeSlotSeries(client, {
      postId: 'p1', weekdays: [2, 0, 2], startTime: '18:00', durationMinutes: 60, capacity: 3, endsOn: null,
    });
    expect(callsTo(calls, 'start_knowledge_slot_series')[0]?.args).toEqual({
      p_post_id: 'p1', p_weekdays: 5, p_start_time: '18:00', p_duration_minutes: 60, p_capacity: 3,
    });
  });
});
