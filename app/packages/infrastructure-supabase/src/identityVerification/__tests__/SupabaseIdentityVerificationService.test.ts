import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { SupabaseIdentityVerificationService } from '../SupabaseIdentityVerificationService';

/** An adapter over a fake client whose `rpc` and `functions.invoke` resolve with the given results. */
function adapter(options: { rpc?: { data: unknown; error: unknown }; invoke?: { data: unknown; error: unknown } }) {
  const rpc = vi.fn().mockResolvedValue(options.rpc ?? { data: null, error: null });
  const invoke = vi.fn().mockResolvedValue(options.invoke ?? { data: null, error: null });
  const client = { rpc, functions: { invoke } } as unknown as SupabaseClient;
  return { svc: new SupabaseIdentityVerificationService(client), rpc, invoke };
}

/** A supabase-js FunctionsHttpError look-alike carrying the raw Response. */
function httpError(status: number, body: unknown) {
  return { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status }) };
}

describe('SupabaseIdentityVerificationService.getStatus', () => {
  it('maps the status row', async () => {
    const { svc, rpc } = adapter({ rpc: { data: [{ status: 'verified', reason_code: null, decided_at: '2026-11-18T09:00:00Z',
      verified_at: '2026-11-18T09:00:00Z', expires_at: '2031-11-18T09:00:00Z' }], error: null } });
    expect(await svc.getStatus()).toEqual({ status: 'verified', reasonCode: null, decidedAt: '2026-11-18T09:00:00Z',
      verifiedAt: '2026-11-18T09:00:00Z', expiresAt: '2031-11-18T09:00:00Z' });
    expect(rpc).toHaveBeenCalledWith('my_identity_verification');
  });

  it('reads an unknown status as not started', async () => {
    const { svc } = adapter({ rpc: { data: [{ status: 'weird' }], error: null } });
    expect((await svc.getStatus()).status).toBe('not_started');
  });

  it('throws BackendUnavailableError when the function is not deployed', async () => {
    const { svc } = adapter({ rpc: { data: null, error: { code: 'PGRST202', message: 'not found' } } });
    await expect(svc.getStatus()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabaseIdentityVerificationService.acceptConsent', () => {
  it('sends the version', async () => {
    const { svc, rpc } = adapter({});
    await svc.acceptConsent('v1');
    expect(rpc).toHaveBeenCalledWith('accept_identity_verification_consent', { p_version: 'v1' });
  });
});

describe('SupabaseIdentityVerificationService.startSession', () => {
  it('returns the hosted HTTPS address and sends no identity', async () => {
    const { svc, invoke } = adapter({ invoke: { data: { url: 'https://verify.example.test/s/1' }, error: null } });
    expect(await svc.startSession()).toEqual({ hostedUrl: 'https://verify.example.test/s/1' });
    expect(invoke).toHaveBeenCalledWith('identity-verification-session', { method: 'POST', body: {} });
  });

  it('turns the function refusal into a BackendRuleError with its reason', async () => {
    const { svc } = adapter({ invoke: { data: null, error: httpError(409, { error: 'verification_attempts_exhausted' }) } });
    await expect(svc.startSession()).rejects.toMatchObject({ reason: 'verification_attempts_exhausted' });
  });

  it('a function that is not deployed is BackendUnavailableError', async () => {
    const { svc } = adapter({ invoke: { data: null, error: httpError(404, 'not found') } });
    await expect(svc.startSession()).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('refuses an answer without an HTTPS address', async () => {
    const { svc } = adapter({ invoke: { data: { url: 'http://insecure.test' }, error: null } });
    await expect(svc.startSession()).rejects.toBeInstanceOf(BackendRuleError);
  });
});
