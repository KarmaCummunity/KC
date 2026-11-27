import { describe, expect, it } from 'vitest';
import { type IdentityProvider, ProviderError, RefusalError } from '../identityProvider';
import { openVerificationSession, type SessionDeps } from '../verificationSession';

const providerWith = (createSession: IdentityProvider['createSession'], sessionConfigured = true): IdentityProvider => ({
  slug: 'didit',
  sessionConfigured,
  createSession,
  verifyWebhook: () => false,
  parseWebhook: () => null,
});

/** Dependencies for a member with consent; every step is recorded in order. */
function setup(overrides: Partial<SessionDeps> = {}) {
  const calls: string[] = [];
  const reported: unknown[] = [];
  const deps: SessionDeps = {
    begin: (userId, slug) => {
      calls.push(`begin:${userId}:${slug}`);
      return Promise.resolve('attempt-1');
    },
    latestConsent: () => Promise.resolve({ version: 'v1', acceptedAt: '2026-11-18T09:00:00Z' }),
    setSession: (attemptId, sessionId) => {
      calls.push(`set:${attemptId}:${sessionId}`);
      return Promise.resolve();
    },
    provider: providerWith((input) => {
      calls.push(`create:${input.attemptId}:${input.consentVersion}:${input.language}`);
      return Promise.resolve({ sessionId: 'sess-1', url: 'https://verify.example.test/s/1' });
    }),
    report: (error) => reported.push(error),
    ...overrides,
  };
  return { deps, calls, reported };
}

describe('openVerificationSession', () => {
  it('opens an attempt, then a provider session tied to it, and returns only the address', async () => {
    const { deps, calls } = setup();

    const answer = await openVerificationSession('user-1', deps);

    expect(answer).toEqual({ status: 200, body: { url: 'https://verify.example.test/s/1' } });
    expect(calls).toEqual(['begin:user-1:didit', 'create:attempt-1:v1:he', 'set:attempt-1:sess-1']);
  });

  it('refuses a signed-out caller with 401 and opens nothing', async () => {
    const { deps, calls } = setup();

    expect((await openVerificationSession(null, deps)).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('answers a database refusal with 409 and its reason, without calling the provider', async () => {
    const { deps, calls } = setup({ begin: () => Promise.reject(new RefusalError('verification_attempts_exhausted')) });

    const answer = await openVerificationSession('user-1', deps);

    expect(answer).toEqual({ status: 409, body: { error: 'verification_attempts_exhausted' } });
    expect(calls).toEqual([]);
  });

  it('answers 500 and reports when the attempt cannot be opened for another reason', async () => {
    const failure = new Error('connection lost');
    const { deps, reported } = setup({ begin: () => Promise.reject(failure) });

    expect(await openVerificationSession('user-1', deps)).toEqual({ status: 500, body: { error: 'internal' } });
    expect(reported).toEqual([failure]);
  });

  it('answers 409 consent_required when the consent is gone after the attempt was opened', async () => {
    const { deps } = setup({ latestConsent: () => Promise.resolve(null) });

    expect(await openVerificationSession('user-1', deps)).toEqual({ status: 409, body: { error: 'consent_required' } });
  });

  it('answers 502 and reports a provider failure', async () => {
    const { deps, reported } = setup({ provider: providerWith(() => Promise.reject(new ProviderError('didit_session_failed', 500))) });

    expect(await openVerificationSession('user-1', deps)).toEqual({ status: 502, body: { error: 'provider_unavailable' } });
    expect(reported).toHaveLength(1);
  });

  it('answers 503 for an unconfigured provider before an attempt is used, and still asks for a member first', async () => {
    const unconfigured = providerWith(() => Promise.reject(new Error('must not be called')), false);
    const { deps, calls } = setup({ provider: unconfigured });

    expect(await openVerificationSession('user-1', deps)).toEqual({ status: 503, body: { error: 'provider_unavailable' } });
    expect((await openVerificationSession(null, deps)).status).toBe(401);
    expect(calls).toEqual([]);
  });
});
