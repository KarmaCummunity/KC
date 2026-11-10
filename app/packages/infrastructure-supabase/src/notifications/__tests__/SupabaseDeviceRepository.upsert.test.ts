import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseDeviceRepository } from '../SupabaseDeviceRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface UpsertCall {
  table: string;
  row: any;
  options: any;
  selected?: string;
  singled: boolean;
}

function makeUpsertClient(opts: {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}): { client: SupabaseClient<any>; calls: UpsertCall[] } {
  const calls: UpsertCall[] = [];
  const client = {
    from: (table: string) => ({
      upsert: (row: any, options: any) => {
        const call: UpsertCall = { table, row, options, singled: false };
        calls.push(call);
        return {
          select: (cols: string) => {
            call.selected = cols;
            return {
              single: async () => {
                call.singled = true;
                return { data: opts.data ?? null, error: opts.error ?? null };
              },
            };
          },
        };
      },
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

describe('SupabaseDeviceRepository — upsert', () => {
  it('targets the user_devices table and upserts the snake_case row with onConflict=push_token', async () => {
    const { client, calls } = makeUpsertClient({ data: FAKE_ROW });
    const repo = new SupabaseDeviceRepository(client);

    await repo.upsert({ userId: 'u_1', pushToken: 'tok_abc', platform: 'ios' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe('user_devices');
    expect(calls[0]?.row).toMatchObject({
      user_id: 'u_1',
      push_token: 'tok_abc',
      platform: 'ios',
    });
    expect(calls[0]?.options).toEqual({ onConflict: 'push_token' });
    expect(calls[0]?.selected).toContain('id');
    expect(calls[0]?.selected).toContain('push_token');
    expect(calls[0]?.selected).not.toBe('*');
    expect(calls[0]?.singled).toBe(true);
  });

  it('stamps last_seen_at with an ISO timestamp on every upsert', async () => {
    const { client, calls } = makeUpsertClient({ data: FAKE_ROW });
    const repo = new SupabaseDeviceRepository(client);

    const before = Date.now();
    await repo.upsert({ userId: 'u_1', pushToken: 'tok_abc', platform: 'android' });
    const after = Date.now();

    const stamped = (calls[0]?.row as { last_seen_at: string }).last_seen_at;
    const t = new Date(stamped).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('maps the returned row to a Device entity (snake → camel)', async () => {
    const { client } = makeUpsertClient({ data: FAKE_ROW });
    const repo = new SupabaseDeviceRepository(client);

    const out = await repo.upsert({ userId: 'u_1', pushToken: 'tok_abc', platform: 'ios' });

    expect(out).toEqual({
      deviceId: 'd_1',
      userId: 'u_1',
      pushToken: 'tok_abc',
      platform: 'ios',
      lastSeenAt: '2026-05-16T12:00:00.000Z',
      active: true,
    });
  });

  it('throws the original error verbatim on insert/update failure (no mapping layer)', async () => {
    const pgError = { code: '23505', message: 'duplicate push_token' };
    const { client } = makeUpsertClient({ error: pgError });
    const repo = new SupabaseDeviceRepository(client);

    await expect(
      repo.upsert({ userId: 'u_1', pushToken: 'tok_abc', platform: 'ios' }),
    ).rejects.toBe(pgError);
  });
});
