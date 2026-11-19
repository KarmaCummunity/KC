import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { type IdentityProvider, ProviderError, RefusalError } from '../_shared/identity/provider.ts';
import { createSessionHandler, type SessionHandlerDeps } from './handler.ts';

const provider = (createSession: IdentityProvider['createSession']): IdentityProvider => ({
  slug: 'didit',
  createSession,
  verifyWebhook: () => Promise.resolve(false),
  parseWebhook: () => null,
});

/** Deps for a signed-in member with consent; `overrides` replace any of them. */
function deps(overrides: Partial<SessionHandlerDeps> = {}) {
  const calls: string[] = [];
  const base: SessionHandlerDeps = {
    authenticate: () => Promise.resolve('user-1'),
    begin: (userId, slug) => { calls.push(`begin:${userId}:${slug}`); return Promise.resolve('attempt-1'); },
    latestConsent: () => Promise.resolve({ version: 'v1', acceptedAt: '2026-11-18T09:00:00Z' }),
    setSession: (attemptId, sessionId) => { calls.push(`set:${attemptId}:${sessionId}`); return Promise.resolve(); },
    provider: provider((input) => {
      calls.push(`create:${input.attemptId}:${input.consentVersion}:${input.language}`);
      return Promise.resolve({ sessionId: 'sess-1', url: 'https://verify.example.test/s/1' });
    }),
    report: () => Promise.resolve(),
  };
  return { deps: { ...base, ...overrides }, calls };
}

const post = () => new Request('http://x/identity-verification-session', { method: 'POST', body: '{}' });

Deno.test('opens an attempt, a provider session tied to it, and returns only the URL', async () => {
  const { deps: d, calls } = deps();
  const response = await createSessionHandler(d)(post());
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { url: 'https://verify.example.test/s/1' });
  assertEquals(calls, ['begin:user-1:didit', 'create:attempt-1:v1:he', 'set:attempt-1:sess-1']);
});

Deno.test('a signed-out caller gets 401 and nothing is opened', async () => {
  const { deps: d, calls } = deps({ authenticate: () => Promise.resolve(null) });
  assertEquals((await createSessionHandler(d)(post())).status, 401);
  assertEquals(calls, []);
});

Deno.test('a database refusal is 409 with its reason and the provider is not called', async () => {
  const { deps: d, calls } = deps({ begin: () => Promise.reject(new RefusalError('verification_attempts_exhausted')) });
  const response = await createSessionHandler(d)(post());
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { error: 'verification_attempts_exhausted' });
  assertEquals(calls, []);
});

Deno.test('a provider failure is 502 and is reported', async () => {
  const reported: unknown[] = [];
  const { deps: d } = deps({
    provider: provider(() => Promise.reject(new ProviderError('didit_session_failed', 500))),
    report: (error) => { reported.push(error); return Promise.resolve(); },
  });
  const response = await createSessionHandler(d)(post());
  assertEquals(response.status, 502);
  assertEquals(await response.json(), { error: 'provider_unavailable' });
  assertEquals(reported.length, 1);
});

Deno.test('only POST is served', async () => {
  const { deps: d } = deps();
  assertEquals((await createSessionHandler(d)(new Request('http://x', { method: 'GET' }))).status, 405);
});
