import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseRideSafetyRepository } from '../SupabaseRideSafetyRepository';
import { SupabaseRidesFeedRepository, mapFeedRow } from '../SupabaseRidesFeedRepository';

const FEED_ROW = {
  post_id: 'p1', owner_id: 'o', direction: 'offer', title: 'Lod to Haifa', departs_at: '2026-01-01T07:00:00Z',
  arrives_at: '2026-01-01T08:00:00Z', origin_name: 'Lod', dest_name: 'Haifa', meeting_points: [{}, {}], seats: 4, seats_left: 3,
  reward_model: 'free', series_id: null, series_more: 2, next_cursor: {},
} as unknown as Parameters<typeof mapFeedRow>[0];

describe('SupabaseRideSafetyRepository', () => {
  it('raises the emergency on the post with the note', async () => {
    const { client, calls } = createFakeClient({ rpc: { report_post_emergency: ok('e1') } });
    await new SupabaseRideSafetyRepository(client).raiseEmergency('p1', 'flat tyre');
    expect(callsTo(calls, 'report_post_emergency')[0]?.args).toEqual({ p_post_id: 'p1', p_note: 'flat tyre' });
  });

  it('keeps the throttle reason and reports a missing function', async () => {
    const throttled = createFakeClient({ rpc: { report_post_emergency: fail('P0001', 'emergency_throttled') } });
    await expect(new SupabaseRideSafetyRepository(throttled.client).raiseEmergency('p1', null)).rejects.toBeInstanceOf(BackendRuleError);
    const missing = createFakeClient({ rpc: { report_post_emergency: fail('PGRST202', 'nope') } });
    await expect(new SupabaseRideSafetyRepository(missing.client).raiseEmergency('p1', null)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabaseRidesFeedRepository', () => {
  it('maps an offer with its free seats and the folded dates', async () => {
    const { client, calls } = createFakeClient({ rpc: { rides_feed: ok([FEED_ROW]) } });
    const items = await new SupabaseRidesFeedRepository(client).list(20);
    expect(callsTo(calls, 'rides_feed')[0]?.args).toEqual({ p_limit: 20, p_filters: {} });
    expect(items).toEqual([
      {
        listingId: 'p1', direction: 'give', title: 'Lod to Haifa', departsAt: '2026-01-01T07:00:00Z', originLabel: 'Lod',
        destLabel: 'Haifa', meetingPoints: 2, seatsLeft: 3, passengers: null, recurrence: null, seriesMore: 2,
      },
    ]);
  });

  it('runs along a route: the offers near both places within the radius', async () => {
    const { client, calls } = createFakeClient({ rpc: { rides_feed: ok([]) } });
    const place = (kind: 'city' | 'junction', id: string) => ({ kind, id, label: id, lat: 0, lng: 0, cityId: null });
    await new SupabaseRidesFeedRepository(client).list(10, { origin: place('city', 'IL-001'), dest: place('junction', '7'), radiusKm: 15 });
    expect(callsTo(calls, 'rides_feed')[0]?.args).toEqual({
      p_limit: 10,
      p_filters: {
        direction: 'offer', radius_km: 15,
        origin: { city_id: 'IL-001', street_id: null, junction_id: null },
        dest: { city_id: null, street_id: null, junction_id: 7 },
      },
    });
    await expect(
      new SupabaseRidesFeedRepository(client).list(10, { origin: place('junction', 'x'), dest: place('city', 'a'), radiusKm: 15 }),
    ).rejects.toMatchObject({ reason: 'ride_place_invalid' });
  });

  it('maps a request to its passengers and drops an unknown direction', () => {
    expect(mapFeedRow({ ...FEED_ROW, direction: 'request', seats: 2 })).toMatchObject({ direction: 'request', seatsLeft: null, passengers: 2 });
    expect(mapFeedRow({ ...FEED_ROW, direction: 'x' })).toBeNull();
  });

  it('reports a missing feed function as BackendUnavailableError', async () => {
    const { client } = createFakeClient({ rpc: { rides_feed: fail('PGRST202', 'nope') } });
    await expect(new SupabaseRidesFeedRepository(client).list(5)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
