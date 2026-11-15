import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BackendUnavailableError } from '@kc/domain';
import type { Database } from '../../database.types';
import { SupabaseAccountGateRepository } from '../SupabaseAccountGateRepository';

interface RpcCall {
  fn: string;
  args: unknown;
}

type RpcError = { code?: string; message: string } | null;

function makeFakeClient(opts: {
  data?: unknown;
  error?: RpcError;
}): { client: SupabaseClient<Database>; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { data: opts.data ?? null, error: opts.error ?? null };
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

/** A `bootstrap_session()` document with the given `account` block. */
function session(account: Record<string, unknown>) {
  return { user_id: 'u_me', account: { onboarding_state: 'completed', ...account }, private_profile: {} };
}

describe('SupabaseAccountGateRepository.checkAccountGate', () => {
  it('reads the gate from bootstrap_session without arguments', async () => {
    const { client, calls } = makeFakeClient({ data: session({ status: 'active' }) });

    await new SupabaseAccountGateRepository(client).checkAccountGate('u_me');

    expect(calls).toEqual([{ fn: 'bootstrap_session', args: undefined }]);
  });

  it('allows an active account', async () => {
    const { client } = makeFakeClient({ data: session({ status: 'active' }) });

    expect(await new SupabaseAccountGateRepository(client).checkAccountGate('u_me')).toEqual({ allowed: true });
  });

  it('blocks a suspension and carries its end', async () => {
    const { client } = makeFakeClient({
      data: session({ status: 'suspended_for_false_reports', status_until: '2026-06-01T00:00:00.000Z' }),
    });

    expect(await new SupabaseAccountGateRepository(client).checkAccountGate('u_me')).toEqual({
      allowed: false,
      reason: 'suspended_for_false_reports',
      until: '2026-06-01T00:00:00.000Z',
    });
  });

  it('omits `until` for a ban without an end', async () => {
    const { client } = makeFakeClient({ data: session({ status: 'banned', status_until: null }) });

    const out = await new SupabaseAccountGateRepository(client).checkAccountGate('u_me');

    expect(out).toEqual({ allowed: false, reason: 'banned', until: undefined });
  });

  it('reports a pending deletion with its purge date as `until`', async () => {
    const { client } = makeFakeClient({
      data: session({
        status: 'pending_deletion',
        status_until: null,
        deletion_requested_at: '2026-05-02T00:00:00.000Z',
        deletion_purge_at: '2026-06-01T00:00:00.000Z',
      }),
    });

    expect(await new SupabaseAccountGateRepository(client).checkAccountGate('u_me')).toEqual({
      allowed: false,
      reason: 'pending_deletion',
      until: '2026-06-01T00:00:00.000Z',
    });
  });

  it('blocks an account that waits for verification', async () => {
    const { client } = makeFakeClient({ data: session({ status: 'pending_verification' }) });

    const out = await new SupabaseAccountGateRepository(client).checkAccountGate('u_me');

    expect(out).toMatchObject({ allowed: false, reason: 'pending_verification' });
  });

  it('refuses a status it does not know instead of letting the member in', async () => {
    const { client } = makeFakeClient({ data: session({ status: 'something_new' }) });

    await expect(new SupabaseAccountGateRepository(client).checkAccountGate('u_me')).rejects.toThrow(
      /unknown account status/,
    );
  });

  it('maps a signed-out caller to the stable reason `unauthenticated`', async () => {
    const { client } = makeFakeClient({ error: { code: '42501', message: 'unauthenticated' } });

    await expect(new SupabaseAccountGateRepository(client).checkAccountGate('u_me')).rejects.toMatchObject({
      code: 'backend_rule',
      reason: 'unauthenticated',
    });
  });

  it('reports a missing bootstrap_session as BackendUnavailableError', async () => {
    const { client } = makeFakeClient({ error: { code: 'PGRST202', message: 'Could not find the function' } });

    await expect(new SupabaseAccountGateRepository(client).checkAccountGate('u_me')).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});

describe('SupabaseAccountGateRepository.restoreAccount (FR-AUTH-016)', () => {
  it('calls restore_account without arguments', async () => {
    const { client, calls } = makeFakeClient({});

    await new SupabaseAccountGateRepository(client).restoreAccount();

    expect(calls).toEqual([{ fn: 'restore_account', args: undefined }]);
  });

  it.each([
    ['grace_expired', 'P0001', 'grace_expired'],
    ['not_pending_deletion', 'P0001', 'not_pending_deletion'],
    ['unauthenticated', '42501', 'unauthenticated'],
  ])('maps the refusal "%s" to the code %s', async (message, sqlState, code) => {
    const { client } = makeFakeClient({ error: { code: sqlState, message } });

    await expect(new SupabaseAccountGateRepository(client).restoreAccount()).rejects.toMatchObject({
      name: 'RestoreAccountError',
      code,
    });
  });

  it('maps an unknown failure to the code network', async () => {
    const { client } = makeFakeClient({ error: { message: 'connection reset' } });

    await expect(new SupabaseAccountGateRepository(client).restoreAccount()).rejects.toMatchObject({
      name: 'RestoreAccountError',
      code: 'network',
    });
  });

  it('lets a missing function reach the degrade rule', async () => {
    const { client } = makeFakeClient({ error: { code: 'PGRST202', message: 'Could not find the function' } });

    await expect(new SupabaseAccountGateRepository(client).restoreAccount()).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});
