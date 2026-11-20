// SEC-1067 (KC#1660) — worker endpoints, checked on the deployed kc-dev Edge Functions.
//
// A worker is an Edge Function that the database's scheduled jobs start. It acts with the service
// role, so it answers exactly one caller: the service-role key (`_shared/serviceRoleGuard.ts`,
// ADR-002). The Deno suite proves the guard is the first thing every worker's handler does; this
// journey proves the deployed workers refuse every caller the app or a visitor can be: no
// credentials, the public key, and a signed-in member.
//
// The worker list is read from the guard's own source, so a new worker is covered the day it joins
// the list. A refused call does no work: the guard answers before the body is read. The accepted
// caller is not tried here, because the suite never holds the service-role key.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { sessionFor } from '../lib/api';
import { SUPABASE_URL, USER_A, anonKey } from '../lib/env';

// No browser session: every call is a plain HTTP request with the headers the test names.
test.use({ storageState: { cookies: [], origins: [] } });

const GUARD_FILE = fileURLToPath(new URL('../../../supabase/functions/_shared/serviceRoleGuard.ts', import.meta.url));
/** Workers the issue names that still exist; the scan must find at least these. */
const KNOWN_WORKERS = ['subscriptions-charger', 'whatsapp-sender'] as const;
/** Tries per call. Only a failure to answer is tried again: kc-dev returns 5xx while a function boots or the project stalls (#2368). */
const ATTEMPTS = 4;
/** Calls in flight at once, so the run does not boot every worker in the same instant. */
const BATCH_SIZE = 5;

/** The names in `SERVICE_ROLE_ONLY_FUNCTIONS`, read from the guard's source. */
function workerNames(source: string): string[] {
  const list = source.match(/SERVICE_ROLE_ONLY_FUNCTIONS = \[([^\]]*)\]/);
  if (!list) throw new Error('serviceRoleGuard.ts: no SERVICE_ROLE_ONLY_FUNCTIONS list');
  return [...list[1]!.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]!);
}

/**
 * Every guarded worker uses the shared refused-caller 401 response.
 * Either way the handler returned before it read the request or opened its service-role client.
 */
const REFUSED: ReadonlySet<number> = new Set([401]);

/** What one worker answered: its HTTP status, or 0 when it never answered. */
interface Answer {
  readonly name: string;
  readonly status: number;
}

/**
 * One POST to a worker as the caller `headers` describe. An answer below 500 is final, whatever it
 * is: a worker that ran for this caller must fail the test, not be asked again until it refuses.
 */
async function callWorker(request: APIRequestContext, name: string, headers: Record<string, string>): Promise<Answer> {
  let status = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const response = await request.post(`${SUPABASE_URL}/functions/v1/${name}`, {
        headers: { ...headers, 'Content-Type': 'application/json' },
        data: {},
        failOnStatusCode: false,
        timeout: 30_000,
      });
      status = response.status();
    } catch {
      // No answer inside the timeout: counted as status 0 and tried again.
      status = 0;
    }
    if (status > 0 && status < 500) break;
  }
  return { name, status };
}

/** Every worker's answer to the same caller, a batch at a time. */
async function callEveryWorker(request: APIRequestContext, headers: Record<string, string>): Promise<Answer[]> {
  const names = workerNames(readFileSync(GUARD_FILE, 'utf8'));
  // The scan must see the list: an empty one would pass by checking nothing.
  for (const name of KNOWN_WORKERS) expect(names, 'workers found in the guard source').toContain(name);
  const answers: Answer[] = [];
  for (let i = 0; i < names.length; i += BATCH_SIZE) {
    answers.push(...(await Promise.all(names.slice(i, i + BATCH_SIZE).map((name) => callWorker(request, name, headers)))));
  }
  return answers;
}

/** The workers that did not refuse, as `name → status`, for the assertion's message. */
const notRefused = (answers: readonly Answer[]) => answers.filter((a) => !REFUSED.has(a.status)).map((a) => `${a.name} → ${a.status}`);

test.describe('worker endpoints answer the service role only', () => {
  test.beforeEach(() => {
    // Up to ATTEMPTS slow answers per worker when kc-dev stalls.
    test.setTimeout(300_000);
  });

  test('a call without credentials is refused by every worker', async ({ request }) => {
    const answers = await callEveryWorker(request, {});
    expect(notRefused(answers), 'workers that did not refuse a call without credentials').toEqual([]);
  });

  test('the public key is refused by every worker', async ({ request }) => {
    const key = await anonKey();
    const answers = await callEveryWorker(request, { apikey: key, Authorization: `Bearer ${key}` });
    expect(notRefused(answers), 'workers that did not refuse the public key').toEqual([]);
  });

  // The platform lets a member's valid token through to the function, so here the refusal is the
  // worker's own check and not the platform's.
  test('a signed-in member is refused by every worker', async ({ request }) => {
    const { session } = await sessionFor(USER_A);
    const answers = await callEveryWorker(request, {
      apikey: await anonKey(),
      Authorization: `Bearer ${session.access_token as string}`,
    });
    expect(notRefused(answers), 'workers that did not refuse a signed-in member').toEqual([]);
  });
});
