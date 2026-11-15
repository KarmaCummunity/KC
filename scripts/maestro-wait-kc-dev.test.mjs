import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeSignIn, waitForSignIn } from './maestro-wait-kc-dev.mjs';

const SECRET = 'Kc-seed-secret-1';
const CREDS = { url: 'https://kc.example.test', anonKey: 'anon', email: 'user1@seed.kc.test', password: SECRET };

/** A fake clock: `sleep` advances it, so the loop runs in no real time. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

test('probeSignIn posts the password grant and reports a session as ok', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ access_token: 'jwt' }) }; };
  assert.deepEqual(await probeSignIn(CREDS, fetchImpl), { ok: true, detail: 'signed in' });
  assert.equal(seen.url, 'https://kc.example.test/auth/v1/token?grant_type=password');
  assert.equal(seen.init.headers.apikey, 'anon');
  assert.deepEqual(JSON.parse(seen.init.body), { email: 'user1@seed.kc.test', password: SECRET });
});

test('probeSignIn reports an HTTP error, an empty response and a network failure without throwing or leaking the password', async () => {
  const http = await probeSignIn(CREDS, async () => ({ ok: false, status: 502 }));
  assert.deepEqual(http, { ok: false, detail: 'HTTP 502' });
  const empty = await probeSignIn(CREDS, async () => ({ ok: true, json: async () => ({}) }));
  assert.equal(empty.ok, false);
  const down = await probeSignIn(CREDS, async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); });
  assert.deepEqual(down, { ok: false, detail: 'request failed (ECONNRESET)' });
  for (const r of [http, empty, down]) assert.equal(JSON.stringify(r).includes(SECRET), false);
});

test('waitForSignIn returns at once when kc-dev already works', async () => {
  const { now, sleep } = clock();
  const r = await waitForSignIn({ probe: async () => ({ ok: true, detail: 'signed in' }), timeoutMs: 600_000, intervalMs: 15_000, sleep, now });
  assert.deepEqual(r, { ok: true, attempts: 1, waitedMs: 0, detail: 'signed in' });
});

test('waitForSignIn keeps probing through an outage and returns once a sign-in works', async () => {
  const { now, sleep } = clock();
  const answers = [{ ok: false, detail: 'HTTP 502' }, { ok: false, detail: 'HTTP 500' }, { ok: true, detail: 'signed in' }];
  const lines = [];
  const r = await waitForSignIn({ probe: async () => answers.shift(), timeoutMs: 600_000, intervalMs: 15_000, sleep, now, log: (l) => lines.push(l) });
  assert.deepEqual(r, { ok: true, attempts: 3, waitedMs: 30_000, detail: 'signed in' });
  assert.deepEqual(lines, ['attempt 1: HTTP 502', 'attempt 2: HTTP 500']);
});

test('waitForSignIn gives up at the timeout and reports the last failure', async () => {
  const { now, sleep } = clock();
  const r = await waitForSignIn({ probe: async () => ({ ok: false, detail: 'HTTP 500' }), timeoutMs: 60_000, intervalMs: 15_000, sleep, now });
  assert.equal(r.ok, false);
  assert.equal(r.detail, 'HTTP 500');
  assert.ok(r.waitedMs <= 60_000 && r.attempts >= 4, `${r.waitedMs}ms, ${r.attempts} attempts`);
});
