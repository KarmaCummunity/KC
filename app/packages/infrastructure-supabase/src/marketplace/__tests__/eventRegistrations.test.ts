// G1 step 5 (0563) — organization event adapter: RPC arguments, row mapping, errors rethrown, and
// the caller-scoped reads (own registration, own organizations) filtered by the session user.
import { describe, it, expect } from 'vitest';
import { SupabaseMarketplaceRepository } from '../SupabaseMarketplaceRepository';
import { mapMyEventRegistration, toMembershipOptions } from '../eventRegistrations';

type Result = { data: unknown; error: unknown };

const ok = (data: unknown): Result => ({ data, error: null });
const boom = { message: 'not_owner' };

/** A thenable query builder that records every filter and resolves to `result`. */
function queryBuilder(result: Result, filters: Array<[string, unknown[]]>) {
  const builder: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'in', 'order', 'limit']) {
    builder[name] = (...args: unknown[]) => {
      filters.push([name, args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (r: Result) => unknown) => resolve(result);
  return builder;
}

function makeRepo(rpcResults: Record<string, Result>, tableResult: Result = ok(null), userId: string | null = 'u_me') {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const filters: Array<[string, unknown[]]> = [];
  const tables: string[] = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return rpcResults[fn] ?? ok(null);
    },
    from: (table: string) => {
      tables.push(table);
      return queryBuilder(tableResult, filters);
    },
    auth: { getSession: async () => ({ data: { session: userId ? { user: { id: userId } } : null } }) },
  };
  return { repo: new SupabaseMarketplaceRepository(client as never), calls, filters, tables };
}

const handoffRow = { handoff_id: 'h1', status: 'reserved', reserved_at: '2026-11-01T00:00:00Z', confirmed_at: null };
const mine = { handoffId: 'h1', status: 'reserved', reservedAt: '2026-11-01T00:00:00Z', confirmedAt: null };

describe('SupabaseMarketplaceRepository — organization events', () => {
  it('registerForEvent passes the target and maps the handoff row', async () => {
    const { repo, calls } = makeRepo({ register_for_event: ok({ ...handoffRow, post_id: 'p1' }) });
    expect(await repo.registerForEvent('p1')).toEqual(mine);
    expect(calls).toEqual([{ fn: 'register_for_event', args: { p_target: 'p1' } }]);
  });

  it('registerForEvent rethrows the server error and refuses an empty result', async () => {
    await expect(makeRepo({ register_for_event: { data: null, error: boom } }).repo.registerForEvent('p1')).rejects.toBe(boom);
    await expect(makeRepo({}).repo.registerForEvent('p1')).rejects.toMatchObject({ code: 'listing_not_available' });
  });

  it('decide and cancel pass the handoff and rethrow errors', async () => {
    const { repo, calls } = makeRepo({});
    await repo.decideEventRegistration('h1', true);
    await repo.cancelEventRegistration('h1');
    expect(calls).toEqual([
      { fn: 'decide_event_registration', args: { p_handoff_id: 'h1', p_approve: true } },
      { fn: 'cancel_event_registration', args: { p_handoff_id: 'h1' } },
    ]);
    const bad = makeRepo({ decide_event_registration: { data: null, error: boom }, cancel_event_registration: { data: null, error: boom } }).repo;
    await expect(bad.decideEventRegistration('h1', false)).rejects.toBe(boom);
    await expect(bad.cancelEventRegistration('h1')).rejects.toBe(boom);
  });

  it('markEventAttendance passes the handoff and the mark, and rethrows event_not_started', async () => {
    const { repo, calls } = makeRepo({});
    await repo.markEventAttendance('h1', false);
    expect(calls).toEqual([{ fn: 'mark_event_attendance', args: { p_handoff_id: 'h1', p_attended: false } }]);
    const early = { message: 'event_not_started' };
    const bad = makeRepo({ mark_event_attendance: { data: null, error: early } }).repo;
    await expect(bad.markEventAttendance('h1', true)).rejects.toBe(early);
  });

  it('listEventRegistrations keeps waitlist and attendance rows and skips unknown states', async () => {
    const base = { recipient_id: 'u2', display_name: 'Dana', reserved_at: 'a', confirmed_at: null };
    const { repo } = makeRepo({
      list_event_registrations: ok([
        { ...base, handoff_id: 'h_w', status: 'waitlisted' },
        { ...base, handoff_id: 'h_a', status: 'handed_over' },
        { ...base, handoff_id: 'h_x', status: 'mystery' },
      ]),
    });
    expect((await repo.listEventRegistrations('p1')).map((r) => r.status)).toEqual(['waitlisted', 'handed_over']);
  });

  it('listEventRegistrations maps the roster and rethrows not_owner', async () => {
    const row = { handoff_id: 'h1', recipient_id: 'u2', display_name: 'Dana', status: 'confirmed', reserved_at: 'a', confirmed_at: 'b' };
    const { repo } = makeRepo({ list_event_registrations: ok([row]) });
    expect(await repo.listEventRegistrations('p1')).toEqual([
      { handoffId: 'h1', recipientId: 'u2', displayName: 'Dana', status: 'confirmed', reservedAt: 'a', confirmedAt: 'b' },
    ]);
    await expect(makeRepo({ list_event_registrations: { data: null, error: boom } }).repo.listEventRegistrations('p1')).rejects.toBe(boom);
  });

  it('getMyEventRegistration reads the caller\'s active row of the post', async () => {
    const { repo, filters, tables } = makeRepo({}, ok(handoffRow));
    expect(await repo.getMyEventRegistration('p1')).toEqual(mine);
    expect(tables).toEqual(['post_handoffs']);
    expect(filters).toEqual(expect.arrayContaining([
      ['eq', ['post_id', 'p1']],
      ['eq', ['recipient_id', 'u_me']],
      ['in', ['status', ['reserved', 'confirmed', 'waitlisted']]],
    ]));
  });

  it('a guest has no registration and no organizations', async () => {
    const { repo, tables } = makeRepo({}, ok(handoffRow), null);
    expect(await repo.getMyEventRegistration('p1')).toBeNull();
    expect(await repo.listMyOrganizations()).toEqual([]);
    expect(tables).toEqual([]);
  });

  it('listMyOrganizations filters by the caller and returns distinct names', async () => {
    const rows = [
      { org_id: 'o2', organizations: { name: 'Zahav' } },
      { org_id: 'o1', organizations: { name: 'Aleph' } },
      { org_id: 'o2', organizations: { name: 'Zahav' } },
    ];
    const { repo, filters } = makeRepo({}, ok(rows));
    expect(await repo.listMyOrganizations()).toEqual([
      { orgId: 'o1', name: 'Aleph' },
      { orgId: 'o2', name: 'Zahav' },
    ]);
    expect(filters).toContainEqual(['eq', ['user_id', 'u_me']]);
  });
});

describe('event row mappers', () => {
  it('drops a registration that is no longer active, and keeps a waitlisted one', () => {
    expect(mapMyEventRegistration({ ...handoffRow, status: 'cancelled' })).toBeNull();
    expect(mapMyEventRegistration({ ...handoffRow, status: 'handed_over' })).toBeNull();
    expect(mapMyEventRegistration({ ...handoffRow, status: 'waitlisted' })?.status).toBe('waitlisted');
  });

  it('skips a membership whose organization is not readable', () => {
    expect(toMembershipOptions([{ org_id: 'o1', organizations: null }])).toEqual([]);
  });
});
