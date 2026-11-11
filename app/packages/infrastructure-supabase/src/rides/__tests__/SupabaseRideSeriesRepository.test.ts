import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseRideSeriesRepository } from '../SupabaseRideSeriesRepository';
import { HAIFA, TEL_AVIV } from './placeFixtures';

const SERIES_ROW = {
  id: 's1', status: 'active', weekdays: 31, depart_time: '07:30:00', duration_minutes: 60, ends_on: null,
  post_template: { title: 'Commute', direction: 'offer' },
  ride_template: { origin_city_id: 'IL-001', dest_city_id: 'IL-002', seats: 3, luggage: false, reward_model: 'free', meeting_points: [] },
};
const KIND = { id: 'k1', slug: 'ride_offer', world_slug: 'rides', direction: 'offer', label_he: 'a', label_en: 'a', detail_schema: {} };
const ROUTE_DETAILS = {
  origin_place_kind: 'city', origin_place_id: 'IL-001', origin_label: 'Tel Aviv', origin_lat: 32.08, origin_lng: 34.78, origin_city_id: 'IL-001',
  dest_place_kind: 'city', dest_place_id: 'IL-002', dest_label: 'Haifa', dest_lat: 32.79, dest_lng: 34.99, dest_city_id: 'IL-002',
  seats_available: 3,
};

describe('SupabaseRideSeriesRepository', () => {
  it('lists the series with the template turned back into form details', async () => {
    const { client } = createFakeClient({
      tables: { ride_series: ok([SERIES_ROW]), cities: ok([TEL_AVIV, HAIFA]), road_junctions: ok([]), streets: ok([]) },
    });
    const [series] = await new SupabaseRideSeriesRepository(client).listMine();
    expect(series).toMatchObject({
      id: 's1', direction: 'give', title: 'Commute', status: 'active', durationMinutes: 60,
      schedule: { weekdays: [0, 1, 2, 3, 4], time: '07:30', endsOn: null },
    });
    expect(series?.details).toMatchObject({ origin_label: 'Tel Aviv', dest_label: 'Haifa', seats_available: 3 });
    expect(series?.details).not.toHaveProperty('departs_at');
  });

  it('creates a series from post and ride payloads without times and returns its soonest ride', async () => {
    const { client, calls } = createFakeClient({
      tables: { post_kinds: ok([KIND]), post_ride_details: ok({ post_id: 'p-first' }) },
      rpc: { create_ride_series: ok('s1') },
    });
    const created = await new SupabaseRideSeriesRepository(client).create({
      kindId: 'k1', direction: 'give', title: 'Commute', summary: null, details: ROUTE_DETAILS,
      schedule: { weekdays: [0, 1], time: '07:30', endsOn: null }, durationMinutes: 45,
    });
    expect(created).toEqual({ seriesId: 's1', firstListingId: 'p-first' });
    const args = callsTo(calls, 'create_ride_series')[0]?.args as Record<string, unknown> & { p_post: object; p_ride: object };
    expect(args.p_weekdays).toBe(3);
    expect(args.p_depart_time).toBe('07:30');
    expect(args.p_post).toMatchObject({ world_slug: 'rides', kind_id: 'k1', direction: 'offer', title: 'Commute', city_id: 'IL-001' });
    expect(args.p_ride).toMatchObject({ origin_city_id: 'IL-001', dest_city_id: 'IL-002', seats: 3 });
    expect(args.p_ride).not.toHaveProperty('departs_at');
  });

  it('refuses a route without official places before calling the server', async () => {
    const { client } = createFakeClient({ tables: { post_kinds: ok([KIND]) } });
    await expect(
      new SupabaseRideSeriesRepository(client).create({
        kindId: 'k1', direction: 'give', title: 't', summary: null, details: {},
        schedule: { weekdays: [0], time: '07:30', endsOn: null }, durationMinutes: null,
      }),
    ).rejects.toMatchObject({ reason: 'ride_place_invalid' });
  });

  it('lists the open upcoming occurrences, soonest first', async () => {
    const { client } = createFakeClient({
      tables: {
        post_ride_details: ok([
          { post_id: 'a', departs_at: '2030-01-01T07:00:00Z', seats: 3, posts: { status: 'open', direction: 'offer' } },
          { post_id: 'b', departs_at: '2030-01-02T07:00:00Z', seats: 3, posts: { status: 'closed_delivered', direction: 'offer' } },
        ]),
      },
    });
    expect(await new SupabaseRideSeriesRepository(client).listOccurrences('s1')).toEqual([
      { listingId: 'a', departsAt: '2030-01-01T07:00:00Z', seatsLeft: 3, passengers: null },
    ]);
  });

  it('updates the schedule and sets the status through the RPCs', async () => {
    const { client, calls } = createFakeClient({ rpc: { update_ride_series: ok(null), set_ride_series_status: ok(null) } });
    const repo = new SupabaseRideSeriesRepository(client);
    await repo.updateSchedule('s1', { weekdays: [1], time: '08:00', endsOn: '2030-06-01' }, null);
    await repo.setStatus('s1', 'paused');
    expect(callsTo(calls, 'update_ride_series')[0]?.args).toEqual({
      p_series_id: 's1', p_depart_time: '08:00', p_weekdays: 2, p_duration_minutes: undefined, p_ends_on: '2030-06-01',
    });
    expect(callsTo(calls, 'set_ride_series_status')[0]?.args).toEqual({ p_series_id: 's1', p_status: 'paused' });
  });

  it('keeps refusal reasons and reports missing objects', async () => {
    const refused = createFakeClient({ rpc: { set_ride_series_status: fail('P0001', 'ride_series_cancelled') } });
    await expect(new SupabaseRideSeriesRepository(refused.client).setStatus('s1', 'active')).rejects.toBeInstanceOf(BackendRuleError);
    const missing = createFakeClient({ tables: { ride_series: fail('PGRST205', 'nope') } });
    await expect(new SupabaseRideSeriesRepository(missing.client).listMine()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
