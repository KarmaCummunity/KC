#!/usr/bin/env node
// Waits until a seed user can sign in to kc-dev, or gives up (KC#1619).
//
// The Maestro journeys run against the shared kc-dev, which a deploy (migrations), a reseed or another
// run can leave unable to sign anyone in for several minutes. A flow that fails on sign-in in such a
// window fails again if it is retried at once, and the lane fails the CI gate of a PR that did nothing.
// maestro-run-android.sh calls this between a failed flow and its retry: it probes the auth endpoint
// until a password sign-in succeeds, so the retry meets a working environment, and when none comes it
// says so plainly instead of leaving a confusing flow assertion.
// ci-maestro-android.yml also calls it before the emulator boots, with a longer wait: on 26-27 Nov 2026
// kc-dev answered HTTP 504 for about eleven hours and 21 of 25 red merge-group runs were that outage,
// each one dropping its PR from the merge queue and rebuilding the groups behind it. Waiting there turns
// an outage into a delay. kc-dev also flapped (one good sign-in between 504s, then the retry failed), so
// KC_WAIT_STREAK asks for several sign-ins in a row before the environment counts as working.
//
// Env: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, KC_E2E_PASSWORD (required),
//      KC_E2E_EMAIL (default user1@seed.kc.test), KC_WAIT_TIMEOUT_MS (default 600000),
//      KC_WAIT_INTERVAL_MS (default 15000), KC_WAIT_STREAK (sign-ins in a row required, default 1).
// Exit: 0 when a sign-in worked, 1 on timeout. It prints status codes and elapsed time only, never a secret.

import { fileURLToPath } from 'node:url';

const DEFAULT_EMAIL = 'user1@seed.kc.test';

/** One password sign-in against the auth endpoint; resolves to `{ ok, detail }` and never throws. */
export async function probeSignIn({ url, anonKey, email, password }, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = await res.json();
    return typeof body?.access_token === 'string' ? { ok: true, detail: 'signed in' } : { ok: false, detail: 'no session in the response' };
  } catch (err) {
    return { ok: false, detail: `request failed (${err?.cause?.code ?? err?.name ?? 'error'})` };
  }
}

/**
 * Probe until `streak` probes in a row succeed or `timeoutMs` passes; a failed probe starts the count
 * again. `probe`, `sleep` and `now` are injected so the loop is testable without a network or a clock.
 * Resolves to `{ ok, attempts, waitedMs, detail }`; on a timeout `detail` is the last failure seen.
 */
export async function waitForSignIn({ probe, timeoutMs, intervalMs, sleep, now, streak = 1, log = () => {} }) {
  const start = now();
  let attempts = 0;
  let inARow = 0;
  let lastFailure = 'no sign-in failed, the wait ended before enough in a row';
  for (;;) {
    attempts += 1;
    const result = await probe();
    const waitedMs = now() - start;
    if (result.ok) {
      inARow += 1;
      if (inARow >= streak) return { ok: true, attempts, waitedMs, detail: result.detail };
    } else {
      inARow = 0;
      lastFailure = result.detail;
      log(`attempt ${attempts}: ${result.detail}`);
    }
    if (waitedMs + intervalMs > timeoutMs) return { ok: false, attempts, waitedMs, detail: lastFailure };
    await sleep(intervalMs);
  }
}

async function main(env = process.env) {
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const password = env.KC_E2E_PASSWORD;
  if (!url || !anonKey || !password) throw new Error('EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY and KC_E2E_PASSWORD are required');
  const email = env.KC_E2E_EMAIL || DEFAULT_EMAIL;
  const result = await waitForSignIn({
    probe: () => probeSignIn({ url, anonKey, email, password }),
    timeoutMs: Number(env.KC_WAIT_TIMEOUT_MS ?? 600_000),
    intervalMs: Number(env.KC_WAIT_INTERVAL_MS ?? 15_000),
    streak: Math.max(1, Number(env.KC_WAIT_STREAK ?? 1) || 1),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
    log: (line) => console.log(`kc-dev sign-in: ${line}`),
  });
  const seconds = Math.round(result.waitedMs / 1000);
  if (result.ok) {
    console.log(`kc-dev sign-in works (${result.attempts} probe(s), ${seconds}s).`);
    return 0;
  }
  console.log(`::warning::kc-dev could not sign ${email} in for ${seconds}s (${result.detail}): a deploy, a reseed or an outage, not a flow.`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}
