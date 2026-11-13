// FR-HOUSING-003, 012, 015–022, 036, 037 — the housing adapter against the baseline objects.
import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseHousingRepository, parseConductState } from '../SupabaseHousingRepository';
import { guestMayViewAddress, pointEwkt, trimmedOrNull } from '../housingMappers';

const HANDOFF = {
  id: 'h1', post_id: 'p1', owner_id: 'host', recipient_id: 'g1', machine_id: 'housing_booking', status: 'reserved',
  cancel_reason: null, slot_starts_at: '2030-03-12T14:00:00Z', slot_ends_at: '2030-03-14T08:00:00Z',
  confirm_by: '2030-03-11T10:00:00Z', created_at: '2030-03-10T10:00:00Z', seats: 3,
};
const DETAILS = {
  handoff_id: 'h1', check_in_date: '2030-03-12', check_out_date: '2030-03-14', adults: 2, minors: 1, message: 'hi',
};
const GUEST = { id: 'g1', display_name: 'Guest', avatar_url: null, verification_level: 2, created_at: '2029-01-01T00:00:00Z' };
const SESSION = { consents: { housing_conduct: { version: 1, accepted: false } } };

const repoOf = (config: Parameters<typeof createFakeClient>[0]) => {
  const fake = createFakeClient(config);
  return { ...fake, repo: new SupabaseHousingRepository(fake.client) };
};

describe('SupabaseHousingRepository — consent and moves', () => {
  it('reads the code of conduct from the session and accepts the version shown', async () => {
    const { repo, calls } = repoOf({ rpc: { bootstrap_session: ok(SESSION), accept_world_consent: ok({ id: 'c1' }) } });
    expect(await repo.currentConductVersion()).toBe(1);
    expect(await repo.hasAcceptedConduct()).toBe(false);
    await repo.acceptConduct(1);
    expect(callsTo(calls, 'accept_world_consent')[0]?.args).toEqual({ p_kind: 'housing_conduct', p_version: 1 });
    expect(parseConductState({})).toBeNull();
  });

  it('requests a stay on the post and returns the booking id', async () => {
    const { repo, calls } = repoOf({ rpc: { request_housing_booking: ok({ ...HANDOFF, id: 'h9' }) } });
    await expect(repo.requestStay({
      listingId: 'p1', checkInDate: '2030-03-12', checkOutDate: '2030-03-14', adults: 2, minors: 0,
      message: 'hi', minorsGuardianAck: false,
    })).resolves.toBe('h9');
    expect(callsTo(calls, 'request_housing_booking')[0]?.args).toEqual({
      p_post_id: 'p1', p_check_in: '2030-03-12', p_check_out: '2030-03-14', p_adults: 2, p_minors: 0,
      p_message: 'hi', p_minors_guardian_ack: false,
    });
  });

  it('closes a stay as completed or as a no-show and sends an absent note as undefined', async () => {
    const { repo, calls } = repoOf({});
    await repo.complete('h1');
    await repo.markNoShow('h1');
    await repo.decide('h1', true, null);
    expect(callsTo(calls, 'close_housing_booking').map((c) => c.args)).toEqual([
      { p_handoff_id: 'h1', p_outcome: 'completed' }, { p_handoff_id: 'h1', p_outcome: 'no_show' },
    ]);
    expect(callsTo(calls, 'decide_housing_booking')[0]?.args).toEqual({ p_handoff_id: 'h1', p_approve: true, p_note: undefined });
  });

  it('keeps the server reason and reports a missing function', async () => {
    const refused = repoOf({ rpc: { cancel_housing_booking: fail('P0001', 'housing_booking_started') } });
    await expect(refused.repo.cancel('h1', null)).rejects.toThrow(BackendRuleError);
    await expect(refused.repo.cancel('h1', null)).rejects.toThrow('housing_booking_started');
    const missing = repoOf({ rpc: { close_housing_booking: fail('PGRST202', 'nope') } });
    await expect(missing.repo.complete('h1')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabaseHousingRepository — lists', () => {
  it('lists the bookings of an offer with the guest trust block, waiting requests first', async () => {
    const confirmed = { ...HANDOFF, id: 'h2', status: 'confirmed', created_at: '2030-03-01T00:00:00Z' };
    const { repo, calls } = repoOf({
      tables: {
        post_handoffs: ok([confirmed, HANDOFF]),
        handoff_booking_details: ok([DETAILS, { ...DETAILS, handoff_id: 'h2' }]),
        users: ok([GUEST]),
        post_ratings: ok([{ handoff_id: 'h2' }]),
      },
      rpc: { housing_completed_stays: ok([{ user_id: 'g1', completed_stays: 3 }]) },
    });
    const rows = await repo.listForOffer('p1');
    expect(rows.map((r) => [r.handoffId, r.status, r.ratedByMe])).toEqual([['h1', 'reserved', false], ['h2', 'confirmed', true]]);
    expect(rows[0]).toMatchObject({
      guestName: 'Guest', guestVerified: true, guestCompletedStays: 3, guestMemberSince: '2029-01-01T00:00:00Z',
      checkInDate: '2030-03-12', startsAt: '2030-03-12T14:00:00Z', adults: 2, minors: 1, message: 'hi',
    });
    expect(callsTo(calls, 'post_handoffs')[0]?.filters).toEqual([
      ['eq', 'post_id', 'p1'], ['eq', 'machine_id', 'housing_booking'], ['in', 'status', ['reserved', 'confirmed', 'handed_over']],
    ]);
    expect(callsTo(calls, 'housing_completed_stays')[0]?.args).toEqual({ p_user_ids: ['g1'] });
  });

  it("lists the guest's own stays with the post and the host", async () => {
    const { repo, calls } = repoOf({
      userId: 'g1',
      tables: {
        post_handoffs: ok([{ ...HANDOFF, status: 'cancelled', cancel_reason: 'host_cancelled' }]),
        handoff_booking_details: ok([DETAILS]),
        posts: ok([{ id: 'p1', title: 'Room', city_id: 'c1' }]),
        users: ok([{ id: 'host', display_name: 'Host' }]),
        post_ratings: ok([]),
      },
    });
    const [stay] = await repo.listMyStays(10);
    expect(stay).toMatchObject({
      listingId: 'p1', listingTitle: 'Room', cityId: 'c1', hostName: 'Host', cancelReason: 'host_cancelled', canViewAddress: false,
    });
    expect(callsTo(calls, 'post_handoffs')[0]?.filters).toContainEqual(['eq', 'recipient_id', 'g1']);
    expect(callsTo(calls, 'post_handoffs')[0]?.filters).toContainEqual(['limit', 10]);
  });

  it('returns no stays when signed out', async () => {
    const { repo, calls } = repoOf({});
    expect(await repo.listMyStays()).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('opens the address to a confirmed guest until a day after the stay', () => {
    const now = new Date('2030-03-15T00:00:00Z');
    expect(guestMayViewAddress('confirmed', '2030-03-14T08:00:00Z', now)).toBe(true);
    expect(guestMayViewAddress('confirmed', '2030-03-13T08:00:00Z', now)).toBe(false);
    expect(guestMayViewAddress('reserved', null, now)).toBe(false);
  });
});

describe('SupabaseHousingRepository — the exact place', () => {
  it('maps the released location and returns null when it is not open', async () => {
    const location = {
      post_id: 'p1', street: 'Herzl', street_number: '5', apartment: '12', floor: '2', entrance_notes: 'Gate B',
      access_notes: 'key under mat', exact_point: null,
    };
    const open = repoOf({ rpc: { get_post_private_location: ok(location) }, tables: { posts: ok({ city_id: 'c1' }) } });
    expect(await open.repo.getPrivateDetails('p1')).toMatchObject({
      cityId: 'c1', streetName: 'Herzl', houseNumber: '5', apartment: '12', floor: '2', entranceNotes: 'Gate B',
      accessInstructions: 'key under mat', lat: null,
    });
    const hidden = repoOf({ rpc: { get_post_private_location: fail('P0001', 'post_not_found') } });
    expect(await hidden.repo.getPrivateDetails('p1')).toBeNull();
  });

  it('writes the street name, each arrival field on its own (0033) and the point', async () => {
    const { repo, calls } = repoOf({ tables: { posts: ok({ city_id: 'c1' }), streets: ok({ name_he: 'Herzl' }) } });
    await repo.setPrivateDetails({
      listingId: 'p1', streetId: 7, houseNumber: ' 5 ', apartment: '3', floor: null, entranceNotes: ' ',
      accessInstructions: 'key under mat', lat: 32.1, lng: 34.8,
    });
    expect(callsTo(calls, 'streets')[0]?.filters).toEqual([['eq', 'city_id', 'c1'], ['eq', 'street_id', 7]]);
    expect(callsTo(calls, 'post_private_locations')[0]?.payload).toEqual({
      post_id: 'p1', street: 'Herzl', street_number: '5', apartment: '3', floor: null, entrance_notes: null,
      access_notes: 'key under mat', exact_point: 'SRID=4326;POINT(34.8 32.1)',
    });
    expect(trimmedOrNull(' ')).toBeNull();
    expect(pointEwkt(null, 1)).toBeNull();
  });
});
