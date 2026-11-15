import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, makeCard, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseVolunteerRepository } from '../SupabaseVolunteerRepository';

const EVENT = { post_id: 'e1', starts_at: '2030-01-01T08:00:00Z', ends_at: '2030-01-01T10:30:00Z', capacity: 10, address_label: 'Community hall' };
const SEATS = { post_id: 'e1', capacity: 10, seats_taken: 7, waitlisted: 0, seats_left: 3 };
const HANDOFF = {
  id: 'h1', post_id: 'e1', owner_id: 'org', recipient_id: 'vol', machine_id: 'event_registration', status: 'confirmed',
  created_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T01:00:00Z',
};

describe('SupabaseVolunteerRepository', () => {
  it('lists the event posts of the time world as opportunities', async () => {
    const { client, calls } = createFakeClient({
      rpc: {
        feed_page: ok([
          { card: makeCard({ id: 'e1', post_type: 'event', world_slug: 'time', title: 'Pack boxes' }), next_cursor: {}, distance_m: null },
          { card: makeCard({ id: 'x', post_type: 'standard', world_slug: 'time' }), next_cursor: {}, distance_m: null },
        ]),
        post_seat_counts: ok([SEATS]),
      },
      tables: { post_event_details: ok([EVENT]) },
    });
    expect(await new SupabaseVolunteerRepository(client).listOpportunities(20)).toEqual([
      { opportunityId: 'e1', title: 'Pack boxes', summary: 'Three seats', locationLabel: 'Community hall', cityId: 'IL-001', nextShiftAt: EVENT.starts_at, openSlots: 3 },
    ]);
    expect(callsTo(calls, 'feed_page')[0]?.args).toEqual({ p_limit: 20, p_filters: { world: 'time', sort: 'newest' } });
    expect(callsTo(calls, 'post_seat_counts')[0]?.args).toEqual({ p_post_ids: ['e1'] });
  });

  it('shows one opportunity as one shift with the caller\'s registration', async () => {
    const { client } = createFakeClient({
      userId: 'vol',
      rpc: { post_cards: ok([makeCard({ id: 'e1', post_type: 'event', title: 'Pack boxes' })]), post_seat_counts: ok([SEATS]) },
      tables: { post_event_details: ok([EVENT]), post_handoffs: ok({ status: 'waitlisted' }) },
    });
    const detail = await new SupabaseVolunteerRepository(client).getOpportunityDetail('e1');
    expect(detail).toMatchObject({ opportunityId: 'e1', organizerId: 'owner-1', title: 'Pack boxes', locationLabel: 'Community hall', status: 'open' });
    expect(detail?.shifts).toEqual([
      { shiftId: 'e1', startsAt: EVENT.starts_at, endsAt: EVENT.ends_at, capacity: 10, filled: 7, slotsOpen: 3, myStatus: 'waitlisted' },
    ]);
  });

  it('shows an event without readable seat counts as having no open places', async () => {
    const { client } = createFakeClient({
      rpc: { post_cards: ok([makeCard({ id: 'e1', post_type: 'event' })]), post_seat_counts: ok([]) },
      tables: { post_event_details: ok([EVENT]) },
    });
    expect((await new SupabaseVolunteerRepository(client).getOpportunityDetail('e1'))?.shifts[0]).toMatchObject({ filled: 0, slotsOpen: 0 });
  });

  it('reports a missing seat count function as unavailable', async () => {
    const { client } = createFakeClient({
      rpc: { feed_page: ok([{ card: makeCard({ id: 'e1', post_type: 'event' }), next_cursor: {}, distance_m: null }]), post_seat_counts: fail('PGRST202', 'missing') },
      tables: { post_event_details: ok([EVENT]) },
    });
    await expect(new SupabaseVolunteerRepository(client).listOpportunities()).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('answers null for an event the caller cannot read', async () => {
    const { client } = createFakeClient({ rpc: { post_cards: ok([]) }, tables: { post_event_details: ok([]) } });
    expect(await new SupabaseVolunteerRepository(client).getOpportunityDetail('e1')).toBeNull();
  });

  it('signs up through the event registration RPC and cancels by handoff id', async () => {
    const { client, calls } = createFakeClient({ rpc: { register_for_event: ok(HANDOFF), cancel_event_registration: ok(HANDOFF) } });
    const repo = new SupabaseVolunteerRepository(client);
    expect(await repo.signUpForShift('e1')).toEqual({ signupId: 'h1', status: 'confirmed' });
    await repo.cancelSignup('h1');
    expect(callsTo(calls, 'cancel_event_registration')[0]?.args).toEqual({ p_handoff_id: 'h1' });
  });

  it('lists the caller\'s sign-ups with the hours of attended shifts', async () => {
    const { client } = createFakeClient({
      userId: 'vol',
      tables: {
        post_handoffs: ok([{ ...HANDOFF, status: 'handed_over' }, { ...HANDOFF, id: 'h2', post_id: 'gone' }]),
        post_event_details: ok([EVENT]),
        posts: ok([{ id: 'e1', title: 'Pack boxes' }]),
      },
    });
    expect(await new SupabaseVolunteerRepository(client).listMySignups()).toEqual([
      { signupId: 'h1', shiftId: 'e1', opportunityId: 'e1', title: 'Pack boxes', startsAt: EVENT.starts_at, endsAt: EVENT.ends_at, status: 'handed_over', hoursLogged: 2.5 },
    ]);
  });

  it('lists the organizer\'s events and the roster with the waiting list numbered', async () => {
    const organizer = createFakeClient({
      userId: 'org',
      tables: {
        posts: ok([{ id: 'e1', title: 'Pack boxes', description: null, city_id: 'IL-001', status: 'open', created_at: 'c', updated_at: 'u' }]),
        post_event_details: ok([EVENT]),
      },
    });
    expect(await new SupabaseVolunteerRepository(organizer.client).listMyOrganizerOpportunities()).toEqual([
      { opportunityId: 'e1', title: 'Pack boxes', summary: null, locationLabel: 'Community hall', cityId: 'IL-001', status: 'open', createdAt: 'c', updatedAt: 'u' },
    ]);
    const roster = createFakeClient({
      tables: {
        post_handoffs: ok([HANDOFF, { ...HANDOFF, id: 'h2', recipient_id: 'v2', status: 'waitlisted' }, { ...HANDOFF, id: 'h3', recipient_id: 'v3', status: 'waitlisted' }]),
        users: ok([{ id: 'vol', display_name: 'Dana', share_handle: 'dana' }]),
        post_event_details: ok([EVENT]),
      },
    });
    const rows = await new SupabaseVolunteerRepository(roster.client).listShiftVolunteers('e1');
    expect(rows.map((r) => [r.signupId, r.displayName, r.waitlistPosition])).toEqual([['h1', 'Dana', null], ['h2', null, 1], ['h3', null, 2]]);
  });

  it('closes the event and messages the registered volunteers', async () => {
    const { client, calls } = createFakeClient({ rpc: { close_post_without_recipient: ok(null), message_event_registrants: ok(3) } });
    const repo = new SupabaseVolunteerRepository(client);
    await repo.closeOpportunity('e1');
    expect(await repo.messageShiftVolunteers('e1', 'see you')).toBe(3);
    expect(callsTo(calls, 'message_event_registrants')[0]?.args).toEqual({ p_post_id: 'e1', p_body: 'see you' });
  });

  it('keeps a refusal reason and reports a missing function', async () => {
    const refused = createFakeClient({ rpc: { close_post_without_recipient: fail('P0001', 'listing_has_active_handoff') } });
    await expect(new SupabaseVolunteerRepository(refused.client).closeOpportunity('e1')).rejects.toBeInstanceOf(BackendRuleError);
    const missing = createFakeClient({ rpc: { feed_page: fail('PGRST202', 'nope') } });
    await expect(new SupabaseVolunteerRepository(missing.client).listOpportunities()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
