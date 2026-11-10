import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseDeviceRepository } from '../SupabaseDeviceRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Fakes for SupabaseDeviceRepository — kept local so each test file is
// independent. The upsert flow is exercised in a sibling test file so
// neither file exceeds the 200-LOC architecture cap.

interface DeleteCall {
  table: string;
  eqCol: string;
  eqVal: unknown;
}

interface ListCall {
  table: string;
  selected: string;
  eqCol: string;
  eqVal: unknown;
}

function makeDeleteClient(opts: {
  error?: { code?: string; message: string } | null;
}): { client: SupabaseClient<any>; calls: DeleteCall[] } {
  const calls: DeleteCall[] = [];
  const client = {
    from: (table: string) => ({
      delete: () => ({
        eq: async (col: string, val: unknown) => {
          calls.push({ table, eqCol: col, eqVal: val });
          return { error: opts.error ?? null };
        },
      }),
    }),
  } as unknown as SupabaseClient<any>;
  return { client, calls };
}

function makeListClient(opts: {
  data?: unknown;
  error?: { message: string } | null;
}): { client: SupabaseClient<any>; calls: ListCall[] } {
  const calls: ListCall[] = [];
  const client = {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: async (col: string, val: unknown) => {
          calls.push({ table, selected: cols, eqCol: col, eqVal: val });
          return { data: opts.data ?? null, error: opts.error ?? null };
        },
      }),
    }),
  } as unknown as SupabaseClient<any>;
  return { client, calls };
}

const FAKE_ROW = {
  id: 'd_1',
  user_id: 'u_1',
  push_token: 'tok_abc',
  platform: 'ios',
  last_seen_at: '2026-05-16T12:00:00.000Z',
};

describe('SupabaseDeviceRepository — deactivate', () => {
  it('deletes by push_token from the devices table', async () => {
    const { client, calls } = makeDeleteClient({});
    const repo = new SupabaseDeviceRepository(client);

    await repo.deactivate('tok_abc');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ table: 'user_devices', eqCol: 'push_token', eqVal: 'tok_abc' });
  });

  it('returns void on success', async () => {
    const { client } = makeDeleteClient({});
    const repo = new SupabaseDeviceRepository(client);
    expect(await repo.deactivate('tok_abc')).toBeUndefined();
  });

  it('silently swallows PGRST116 (no-row) — deactivating an unknown token is a no-op', async () => {
    const { client } = makeDeleteClient({
      error: { code: 'PGRST116', message: 'no rows' },
    });
    const repo = new SupabaseDeviceRepository(client);

    await expect(repo.deactivate('tok_unknown')).resolves.toBeUndefined();
  });

  it('throws other Supabase errors verbatim', async () => {
    const pgError = { code: '42501', message: 'permission denied' };
    const { client } = makeDeleteClient({ error: pgError });
    const repo = new SupabaseDeviceRepository(client);

    await expect(repo.deactivate('tok_abc')).rejects.toBe(pgError);
  });
});

describe('SupabaseDeviceRepository — listForUser', () => {
  it('selects explicit columns from devices filtered by user_id', async () => {
    const { client, calls } = makeListClient({ data: [] });
    const repo = new SupabaseDeviceRepository(client);

    await repo.listForUser('u_1');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe('user_devices');
    expect(calls[0]?.selected).toContain('id');
    expect(calls[0]?.selected).toContain('push_token');
    expect(calls[0]?.selected).not.toBe('*');
    expect(calls[0]?.eqCol).toBe('user_id');
    expect(calls[0]?.eqVal).toBe('u_1');
  });

  it('maps each row to a Device entity', async () => {
    const { client } = makeListClient({
      data: [
        FAKE_ROW,
        { ...FAKE_ROW, id: 'd_2', push_token: 'tok_2', platform: 'web' },
      ],
    });
    const repo = new SupabaseDeviceRepository(client);

    const out = await repo.listForUser('u_1');

    expect(out).toHaveLength(2);
    expect(out[0]?.deviceId).toBe('d_1');
    expect(out[1]).toMatchObject({
      deviceId: 'd_2',
      pushToken: 'tok_2',
      platform: 'web',
      active: true,
    });
  });

  it('returns [] when data is null (defensive coalesce)', async () => {
    const { client } = makeListClient({ data: null });
    const repo = new SupabaseDeviceRepository(client);

    expect(await repo.listForUser('u_1')).toEqual([]);
  });

  it('throws the original Supabase error verbatim on query failure', async () => {
    const pgError = { message: 'transport error' };
    const { client } = makeListClient({ error: pgError });
    const repo = new SupabaseDeviceRepository(client);

    await expect(repo.listForUser('u_1')).rejects.toBe(pgError);
  });
});
