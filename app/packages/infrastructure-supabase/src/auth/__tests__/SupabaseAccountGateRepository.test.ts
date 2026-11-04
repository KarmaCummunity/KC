import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAccountGateRepository } from '../SupabaseAccountGateRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface RpcCall {
  fn: string;
  args: unknown;
}

function makeFakeClient(opts: {
  data?: unknown;
  error?: { message: string } | null;
}): { client: SupabaseClient<any>; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { data: opts.data ?? null, error: opts.error ?? null };
    },
  } as unknown as SupabaseClient<any>;
  return { client, calls };
}

describe('SupabaseAccountGateRepository', () => {
  it('calls auth_check_account_gate with p_user_id', async () => {
    const { client, calls } = makeFakeClient({ data: [{ allowed: true }] });
    const repo = new SupabaseAccountGateRepository(client);

    await repo.checkAccountGate('u_me');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.fn).toBe('auth_check_account_gate');
    expect(calls[0]?.args).toEqual({ p_user_id: 'u_me' });
  });

  it('returns { allowed: true } when the RPC returns an allowed row', async () => {
    const { client } = makeFakeClient({
      data: [{ allowed: true, reason: null, until_at: null }],
    });
    const repo = new SupabaseAccountGateRepository(client);

    expect(await repo.checkAccountGate('u_me')).toEqual({ allowed: true });
  });

  it('returns { allowed: true } when the RPC returns no rows (defensive)', async () => {
    const { client } = makeFakeClient({ data: [] });
    const repo = new SupabaseAccountGateRepository(client);

    expect(await repo.checkAccountGate('u_me')).toEqual({ allowed: true });
  });

  it('returns { allowed: true } when data is null (defensive)', async () => {
    const { client } = makeFakeClient({ data: null });
    const repo = new SupabaseAccountGateRepository(client);

    expect(await repo.checkAccountGate('u_me')).toEqual({ allowed: true });
  });

  it('surfaces reason and until when the user is blocked', async () => {
    const { client } = makeFakeClient({
      data: [
        {
          allowed: false,
          reason: 'suspended_for_false_reports',
          until_at: '2026-06-01T00:00:00.000Z',
        },
      ],
    });
    const repo = new SupabaseAccountGateRepository(client);

    expect(await repo.checkAccountGate('u_me')).toEqual({
      allowed: false,
      reason: 'suspended_for_false_reports',
      until: '2026-06-01T00:00:00.000Z',
    });
  });

  it('omits `until` when the RPC returns a null until_at', async () => {
    const { client } = makeFakeClient({
      data: [{ allowed: false, reason: 'banned', until_at: null }],
    });
    const repo = new SupabaseAccountGateRepository(client);

    const out = await repo.checkAccountGate('u_me');
    expect(out.allowed).toBe(false);
    if (!out.allowed) {
      expect(out.reason).toBe('banned');
      expect(out.until).toBeUndefined();
    }
  });

  it('throws InfrastructureError when the RPC fails', async () => {
    const { client } = makeFakeClient({ error: { message: 'network down' } });
    const repo = new SupabaseAccountGateRepository(client);

    await expect(repo.checkAccountGate('u_me')).rejects.toThrow(
      /auth_check_account_gate failed: network down/,
    );
  });

  describe('restoreAccount (FR-AUTH-016)', () => {
    it('calls rpc_restore_account without arguments', async () => {
      const { client, calls } = makeFakeClient({});
      await new SupabaseAccountGateRepository(client).restoreAccount();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.fn).toBe('rpc_restore_account');
    });

    it.each([
      ['grace_expired', 'grace_expired'],
      ['not_pending_deletion', 'not_pending_deletion'],
      ['unauthenticated', 'unauthenticated'],
      ['connection reset', 'network'],
    ])('maps the RPC error "%s" to the code %s', async (message, code) => {
      const { client } = makeFakeClient({ error: { message } });
      await expect(new SupabaseAccountGateRepository(client).restoreAccount()).rejects.toMatchObject({
        name: 'RestoreAccountError',
        code,
      });
    });
  });
});
