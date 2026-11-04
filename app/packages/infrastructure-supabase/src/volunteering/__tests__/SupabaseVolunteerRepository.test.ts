import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseVolunteerRepository } from '../SupabaseVolunteerRepository';

type Result = { data: unknown; error: unknown };

function makeRepo(results: Record<string, Result>) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return results[fn] ?? { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { repo: new SupabaseVolunteerRepository(client as never), calls };
}

const ok = (data: unknown): Result => ({ data, error: null });
const boom = { message: 'boom' };
const fail: Result = { data: null, error: boom };

describe('SupabaseVolunteerRepository — reads', () => {
  it('listOpportunities maps rows, passes paging, [] on error', async () => {
    const { repo, calls } = makeRepo({
      list_volunteer_opportunities: ok([
        {
          opportunity_id: 'o1',
          title: 'Pantry',
          summary: null,
          location_label: 'TLV',
          city_id: 'c1',
          next_shift_at: '2026-10-18T08:00:00Z',
          open_slots: 3,
        },
      ]),
    });
    expect(await repo.listOpportunities()).toEqual([
      {
        opportunityId: 'o1',
        title: 'Pantry',
        summary: null,
        locationLabel: 'TLV',
        cityId: 'c1',
        nextShiftAt: '2026-10-18T08:00:00Z',
        openSlots: 3,
      },
    ]);
    expect(calls[0]?.args).toEqual({ p_limit: 30, p_offset: 0 });
    expect(await makeRepo({ list_volunteer_opportunities: fail }).repo.listOpportunities(5, 5)).toEqual([]);
  });

  it('getOpportunityDetail parses shifts and skips junk', async () => {
    const { repo } = makeRepo({
      get_volunteer_opportunity_detail: ok({
        opportunity_id: 'o1',
        organizer_id: 'u1',
        title: 'Pantry',
        summary: 'Sort',
        location_label: null,
        city_id: 'c1',
        status: 'published',
        shifts: [
          null,
          'junk',
          { shift_id: 's1', starts_at: 'a', ends_at: 'b', capacity: 4, filled: 1, slots_open: 3, my_status: 'registered' },
          { shift_id: 's2', starts_at: 'c', ends_at: 'd' },
        ],
      }),
    });
    expect(await repo.getOpportunityDetail('o1')).toEqual({
      opportunityId: 'o1',
      organizerId: 'u1',
      title: 'Pantry',
      summary: 'Sort',
      locationLabel: null,
      cityId: 'c1',
      status: 'published',
      shifts: [
        { shiftId: 's1', startsAt: 'a', endsAt: 'b', capacity: 4, filled: 1, slotsOpen: 3, myStatus: 'registered' },
        { shiftId: 's2', startsAt: 'c', endsAt: 'd', capacity: 0, filled: 0, slotsOpen: 0, myStatus: null },
      ],
    });
  });

  it('getOpportunityDetail returns null on error or empty payload', async () => {
    expect(await makeRepo({ get_volunteer_opportunity_detail: fail }).repo.getOpportunityDetail('o1')).toBeNull();
    expect(await makeRepo({}).repo.getOpportunityDetail('o1')).toBeNull();
    const noShifts = await makeRepo({
      get_volunteer_opportunity_detail: ok({ opportunity_id: 'o1', organizer_id: 'u', title: 't', status: 'draft' }),
    }).repo.getOpportunityDetail('o1');
    expect(noShifts?.shifts).toEqual([]);
    expect(noShifts?.summary).toBeNull();
  });

  it('listMySignups maps hours to numbers, [] on error', async () => {
    const { repo } = makeRepo({
      list_my_volunteer_signups: ok([
        { signup_id: 'su1', shift_id: 's1', opportunity_id: 'o1', title: 'P', starts_at: 'a', ends_at: 'b', status: 'checked_in', hours_logged: '2.50' },
        { signup_id: 'su2', shift_id: 's2', opportunity_id: 'o1', title: 'P', starts_at: 'c', ends_at: 'd', status: 'registered', hours_logged: null },
      ]),
    });
    const rows = await repo.listMySignups();
    expect(rows.map((r) => r.hoursLogged)).toEqual([2.5, null]);
    expect(rows[0]?.signupId).toBe('su1');
    expect(await makeRepo({ list_my_volunteer_signups: fail }).repo.listMySignups()).toEqual([]);
  });

  it('listMyOrganizerOpportunities and listShiftVolunteers map rows', async () => {
    const { repo } = makeRepo({
      list_my_volunteer_opportunities: ok([
        { opportunity_id: 'o1', title: 'P', summary: null, location_label: null, city_id: null, status: 'draft', created_at: 'x', updated_at: 'y' },
      ]),
      list_shift_volunteers: ok([
        { signup_id: 'su1', user_id: 'u1', display_name: 'D', share_handle: 'd', status: 'waitlisted', waitlist_position: 1, hours_logged: null },
        { signup_id: 'su2', user_id: 'u2', display_name: null, share_handle: null, status: 'checked_in', waitlist_position: null, hours_logged: 3 },
      ]),
    });
    expect(await repo.listMyOrganizerOpportunities()).toEqual([
      { opportunityId: 'o1', title: 'P', summary: null, locationLabel: null, cityId: null, status: 'draft', createdAt: 'x', updatedAt: 'y' },
    ]);
    const roster = await repo.listShiftVolunteers('s1');
    expect(roster.map((r) => [r.userId, r.waitlistPosition, r.hoursLogged])).toEqual([
      ['u1', 1, null],
      ['u2', null, 3],
    ]);
    const bad = makeRepo({ list_my_volunteer_opportunities: fail, list_shift_volunteers: fail }).repo;
    expect(await bad.listMyOrganizerOpportunities()).toEqual([]);
    expect(await bad.listShiftVolunteers('s1')).toEqual([]);
  });
});

describe('SupabaseVolunteerRepository — writes', () => {
  it('signUpForShift returns signup id/status and throws on error', async () => {
    const { repo } = makeRepo({ sign_up_volunteer_shift: ok({ signup_id: 'su1', status: 'registered' }) });
    expect(await repo.signUpForShift('s1')).toEqual({ signupId: 'su1', status: 'registered' });
    await expect(makeRepo({ sign_up_volunteer_shift: fail }).repo.signUpForShift('s1')).rejects.toBe(boom);
    await expect(makeRepo({}).repo.signUpForShift('s1')).rejects.toThrow('sign_up_volunteer_shift failed');
  });

  it('checkIn returns hours and karma, throws on bad payload', async () => {
    const { repo } = makeRepo({ check_in_volunteer_shift: ok({ hours_logged: 1.5, karma_points: 2 }) });
    expect(await repo.checkIn('su1')).toEqual({ hoursLogged: 1.5, karmaPoints: 2 });
    expect(await makeRepo({ check_in_volunteer_shift: ok({}) }).repo.checkIn('su1')).toEqual({
      hoursLogged: 0,
      karmaPoints: 0,
    });
    await expect(makeRepo({ check_in_volunteer_shift: fail }).repo.checkIn('su1')).rejects.toBe(boom);
    await expect(makeRepo({}).repo.checkIn('su1')).rejects.toThrow('check_in_volunteer_shift failed');
  });

  it('void writes resolve on success and throw on error', async () => {
    const good = makeRepo({}).repo;
    await expect(good.cancelSignup('su1')).resolves.toBeUndefined();
    await expect(good.closeOpportunity('o1')).resolves.toBeUndefined();
    const bad = makeRepo({
      cancel_volunteer_signup: fail,
      close_volunteer_opportunity: fail,
    }).repo;
    await expect(bad.cancelSignup('su1')).rejects.toBe(boom);
    await expect(bad.closeOpportunity('o1')).rejects.toBe(boom);
  });

  it('getShiftIcs and messageShiftVolunteers', async () => {
    const { repo } = makeRepo({
      get_volunteer_shift_ics: ok('BEGIN:VCALENDAR'),
      organizer_message_shift_volunteers: ok(4),
    });
    expect(await repo.getShiftIcs('s1')).toBe('BEGIN:VCALENDAR');
    expect(await repo.messageShiftVolunteers('s1', 'hi')).toBe(4);
    const empty = makeRepo({}).repo;
    expect(await empty.getShiftIcs('s1')).toBeNull();
    expect(await empty.messageShiftVolunteers('s1', 'hi')).toBe(0);
    const bad = makeRepo({ get_volunteer_shift_ics: fail, organizer_message_shift_volunteers: fail }).repo;
    await expect(bad.getShiftIcs('s1')).rejects.toBe(boom);
    await expect(bad.messageShiftVolunteers('s1', 'hi')).rejects.toBe(boom);
  });
});
