import { describe, expect, it } from 'vitest';
import { BackendRuleError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabasePostSeriesRepository, mapPostSeriesRow } from '../SupabasePostSeriesRepository';

const SERIES_ROW = {
  id: 's1', status: 'active', weekdays: 0b100, start_time: '17:00:00', duration_minutes: 120, ends_on: null,
  time_zone: 'Asia/Jerusalem', post_template: { title: 'Garden day' }, event_template: { capacity: 12 },
};
const KIND = { id: 'k1', slug: 'event', world_slug: 'time', direction: 'offer', label_he: 'a', label_en: 'a', detail_schema: {} };
const UPCOMING = [
  { post_id: 'p1', starts_at: '2026-11-17T15:00:00Z', series_on: '2026-11-17', posts: { status: 'open' } },
  { post_id: 'p2', starts_at: '2026-11-24T15:00:00Z', series_on: '2026-11-24', posts: { status: 'paused' } },
];

describe('SupabasePostSeriesRepository (FR-POST-024)', () => {
  it('lists my series with their schedule, title and capacity', async () => {
    const { client } = createFakeClient({ tables: { post_series: ok([SERIES_ROW, { ...SERIES_ROW, id: 's2', status: 'archived' }]) } });
    await expect(new SupabasePostSeriesRepository(client).listMine()).resolves.toEqual([{
      id: 's1', title: 'Garden day', capacity: 12, timeZone: 'Asia/Jerusalem', status: 'active',
      schedule: { weekdays: [2], startTime: '17:00', durationMinutes: 120, endsOn: null },
    }]);
  });

  it('creates a series from post and event payloads without times and returns its soonest date', async () => {
    const { client, calls } = createFakeClient({
      tables: { post_kinds: ok([KIND]), post_event_details: ok(UPCOMING) },
      rpc: { create_post_series: ok('s1') },
    });
    const created = await new SupabasePostSeriesRepository(client).create({
      kindId: 'k1', title: 'Garden day', summary: null, cityId: 'c1', timeZone: 'Asia/Jerusalem', orgId: 'o1',
      details: { capacity: 12, registration_policy: 'manual', address: 'Community garden', starts_at: 'x', ends_at: 'y' },
      schedule: { weekdays: [2], startTime: '17:00', durationMinutes: 120, endsOn: '2026-12-31' },
    });
    expect(created).toEqual({ seriesId: 's1', firstPostId: 'p1' });
    const args = callsTo(calls, 'create_post_series')[0]?.args as Record<string, unknown> & { p_post: object; p_event: object };
    expect(args).toMatchObject({
      p_start_time: '17:00', p_weekdays: 0b100, p_duration_minutes: 120, p_ends_on: '2026-12-31',
      p_time_zone: 'Asia/Jerusalem', p_org_id: 'o1',
    });
    expect(args.p_post).toMatchObject({ world_slug: 'time', kind_id: 'k1', direction: 'offer', title: 'Garden day', city_id: 'c1' });
    expect(args.p_event).toEqual({ capacity: 12, registration_policy: 'manual', address_label: 'Community garden' });
  });

  it('lists only the upcoming open dates of a series', async () => {
    const { client } = createFakeClient({ tables: { post_event_details: ok(UPCOMING) } });
    await expect(new SupabasePostSeriesRepository(client).listOccurrences('s1')).resolves.toEqual([
      { postId: 'p1', occurrenceOn: '2026-11-17', startsAt: '2026-11-17T15:00:00Z' },
    ]);
  });

  it('edits the schedule, changes the status and cancels one date through their RPCs', async () => {
    const { client, calls } = createFakeClient({
      rpc: { update_post_series: ok(null), set_post_series_status: ok(null), cancel_post_series_date: ok(null) },
    });
    const repo = new SupabasePostSeriesRepository(client);
    await repo.update('s1', { schedule: { weekdays: [0, 2], startTime: '18:30', durationMinutes: 90, endsOn: null } });
    await repo.setStatus('s1', 'ended');
    await repo.cancelOccurrence('p9');
    expect(callsTo(calls, 'update_post_series')[0]?.args).toEqual({
      p_series_id: 's1', p_start_time: '18:30', p_weekdays: 0b101, p_duration_minutes: 90, p_ends_on: undefined,
    });
    expect(callsTo(calls, 'set_post_series_status')[0]?.args).toEqual({ p_series_id: 's1', p_status: 'ended' });
    expect(callsTo(calls, 'cancel_post_series_date')[0]?.args).toEqual({ p_post_id: 'p9' });
  });

  it('passes the server refusal on as a rule error', async () => {
    const { client } = createFakeClient({ rpc: { set_post_series_status: fail('P0001', 'illegal_transition') } });
    await expect(new SupabasePostSeriesRepository(client).setStatus('s1', 'active')).rejects.toBeInstanceOf(BackendRuleError);
  });

  it('drops a row whose status the app does not know', () => {
    expect(mapPostSeriesRow({ ...SERIES_ROW, status: 'archived' } as never)).toBeNull();
  });
});
