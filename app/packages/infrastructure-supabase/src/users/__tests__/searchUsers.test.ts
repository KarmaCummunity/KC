import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { searchUsers } from '../searchUsers';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface UsersCall {
  table: 'users';
  selected: string;
  orClause: string;
  neqCol: string;
  neqVal: unknown;
  limit: number;
}

interface BlocksCall {
  table: 'blocks';
  selected: string;
  eqCol: string;
  eqVal: unknown;
}

type AnyCall = UsersCall | BlocksCall;

function makeFakeClient(opts: {
  usersData?: unknown;
  usersError?: { message: string } | null;
  blocksData?: unknown;
  blocksError?: { message: string } | null;
}): { client: SupabaseClient<any>; calls: AnyCall[] } {
  const calls: AnyCall[] = [];
  const client = {
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: (cols: string) => ({
            or: (orClause: string) => ({
              neq: (neqCol: string, neqVal: unknown) => ({
                limit: async (limit: number) => {
                  calls.push({
                    table: 'users',
                    selected: cols,
                    orClause,
                    neqCol,
                    neqVal,
                    limit,
                  });
                  return {
                    data: opts.usersData ?? null,
                    error: opts.usersError ?? null,
                  };
                },
              }),
            }),
          }),
        };
      }
      if (table === 'blocks') {
        return {
          select: (cols: string) => ({
            eq: async (eqCol: string, eqVal: unknown) => {
              calls.push({ table: 'blocks', selected: cols, eqCol, eqVal });
              return {
                data: opts.blocksData ?? null,
                error: opts.blocksError ?? null,
              };
            },
          }),
        };
      }
      throw new Error(`fake: unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<any>;
  return { client, calls };
}

describe('searchUsers — query length gating', () => {
  it('returns [] without calling the DB for an empty query', async () => {
    const { client, calls } = makeFakeClient({});

    const out = await searchUsers(client, '', { excludeUserId: 'u_me', limit: 10 });

    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('returns [] without calling the DB for a single character (after trim)', async () => {
    const { client, calls } = makeFakeClient({});

    const out = await searchUsers(client, '  a  ', { excludeUserId: 'u_me', limit: 10 });

    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('searchUsers — query shape', () => {
  it('builds the OR ILIKE clause across display_name + share_handle', async () => {
    const { client, calls } = makeFakeClient({ usersData: [], blocksData: [] });

    await searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: 10 });

    const usersCall = calls.find((c) => c.table === 'users') as UsersCall;
    expect(usersCall.orClause).toBe('display_name.ilike."%ali%",share_handle.ilike."%ali%"');
  });

  it('escapes ILIKE wildcards %, _, \\ then quote-wraps before interpolation', async () => {
    const { client, calls } = makeFakeClient({ usersData: [], blocksData: [] });

    await searchUsers(client, '50%_off\\', { excludeUserId: 'u_me', limit: 10 });

    const usersCall = calls.find((c) => c.table === 'users') as UsersCall;
    expect(usersCall.orClause).toBe(
      String.raw`display_name.ilike."%50\\%\\_off\\\\%",share_handle.ilike."%50\\%\\_off\\\\%"`,
    );
  });

  it('quotes an injected comma/predicate so it stays inside the value (CWE-943)', async () => {
    const { client, calls } = makeFakeClient({ usersData: [], blocksData: [] });

    await searchUsers(client, 'x,city.eq.IL', { excludeUserId: 'u_me', limit: 10 });

    const usersCall = calls.find((c) => c.table === 'users') as UsersCall;
    expect(usersCall.orClause).toBe(
      'display_name.ilike."%x,city.eq.IL%",share_handle.ilike."%x,city.eq.IL%"',
    );
  });

  it('excludes the caller from results via neq(user_id, excludeUserId)', async () => {
    const { client, calls } = makeFakeClient({ usersData: [], blocksData: [] });

    await searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: 10 });

    const usersCall = calls.find((c) => c.table === 'users') as UsersCall;
    expect(usersCall.neqCol).toBe('user_id');
    expect(usersCall.neqVal).toBe('u_me');
  });

  describe('limit clamping', () => {
    it('forwards a sensible limit as-is', async () => {
      const { client, calls } = makeFakeClient({ usersData: [], blocksData: [] });
      await searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: 25 });
      expect((calls.find((c) => c.table === 'users') as UsersCall).limit).toBe(25);
    });

    it('clamps limits above 50 down to 50', async () => {
      const { client, calls } = makeFakeClient({ usersData: [], blocksData: [] });
      await searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: 999 });
      expect((calls.find((c) => c.table === 'users') as UsersCall).limit).toBe(50);
    });

    it('clamps limits below 1 up to 1', async () => {
      const { client, calls } = makeFakeClient({ usersData: [], blocksData: [] });
      await searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: 0 });
      expect((calls.find((c) => c.table === 'users') as UsersCall).limit).toBe(1);
    });
  });
});

// Blocks-filtering tests live in searchUsers.blocks.test.ts so each
// file stays under the 200-LOC architecture cap.

describe('searchUsers — result shape + error path', () => {
  it('returns [] when usersData is null (defensive coalesce)', async () => {
    const { client } = makeFakeClient({ usersData: null, blocksData: [] });

    const out = await searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: 10 });

    expect(out).toEqual([]);
  });

  it('throws with a prefixed "searchUsers: " message when the users query errors', async () => {
    const { client } = makeFakeClient({
      usersError: { message: 'transport error' },
    });

    await expect(
      searchUsers(client, 'ali', { excludeUserId: 'u_me', limit: 10 }),
    ).rejects.toThrow('searchUsers: transport error');
  });
});
