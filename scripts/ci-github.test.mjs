// Unit tests for scripts/ci-github.mjs. Run: node --test scripts/ci-github.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_PAGES, findOwnerOverride, githubFetch, githubList, laneResults, ownerApproval, parseOwners, rateLimitOf } from './ci-github.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const review = (login, state, commit = HEAD) => ({ user: { login }, state, commit_id: commit });
const judge = (reviews, author = 'agent-bot') => ownerApproval({ reviews, owners: ['navesarussi'], headSha: HEAD, author });

test('an owner approval on the head SHA overrides', () => {
  assert.equal(judge([review('NaveSarussi', 'APPROVED')]), 'navesarussi');
});

test('an approval on an older commit does not count', () => {
  assert.equal(judge([review('navesarussi', 'APPROVED', OLD)]), null);
});

test('only allowlisted reviewers count', () => {
  assert.equal(judge([review('someone-else', 'APPROVED')]), null);
});

test('the PR author cannot approve their own PR', () => {
  assert.equal(judge([review('navesarussi', 'APPROVED')], 'navesarussi'), null);
});

test('a later change request or dismissal withdraws the approval', () => {
  assert.equal(judge([review('navesarussi', 'APPROVED'), review('navesarussi', 'CHANGES_REQUESTED')]), null);
  assert.equal(judge([review('navesarussi', 'APPROVED'), review('navesarussi', 'DISMISSED')]), null);
});

test('a later comment does not withdraw the approval', () => {
  assert.equal(judge([review('navesarussi', 'APPROVED'), review('navesarussi', 'COMMENTED')]), 'navesarussi');
});

test('parseOwners lower-cases logins and rejects malformed files', () => {
  assert.deepEqual(parseOwners('{"owners":["NaveSarussi"]}'), ['navesarussi']);
  assert.throws(() => parseOwners('{"owners":"navesarussi"}'), /must be an array/);
  assert.throws(() => parseOwners('{"owners":[""]}'), /must be an array/);
  assert.throws(() => parseOwners('not json'));
});

test('the committed owners allowlist parses', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  assert.ok(parseOwners(readFileSync(join(root, '.github/owners.json'), 'utf8')).length > 0);
});

test('no override outside a PR event, without calling the API', async () => {
  const r = await findOwnerOverride({ EVENT_NAME: 'merge_group', PR_NUMBER: '' }, 'HEAD');
  assert.equal(r.login, null);
  assert.match(r.why, /merge_group run has no PR review/);
});

const job = (name, conclusion, status = 'completed') => ({ name, conclusion, status });

test('laneResults folds inner jobs into one result per lane', () => {
  const jobs = [
    job('detect changes', 'success'),
    job('frontend / quality', 'success'),
    job('frontend / sonar', 'skipped'),
    job('backend', 'skipped'),
    job('edge / deno', 'failure'),
    job('release / e2e', 'cancelled'),
    job('static / static guards', 'success', 'in_progress'),
  ];
  assert.deepEqual(laneResults(jobs, ['frontend', 'backend', 'edge', 'release', 'static', 'hygiene']), {
    frontend: 'success',
    backend: 'skipped',
    edge: 'failure',
    release: 'cancelled',
    static: 'failure',
    hygiene: 'missing',
  });
});

test('laneResults does not confuse lanes sharing a prefix', () => {
  assert.deepEqual(laneResults([job('frontend-extra / x', 'failure')], ['frontend']), { frontend: 'missing' });
});

/** Run `fn` with global fetch answering every GET with `body`. */
async function withFetch(body, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => body });
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test('githubList returns a short list and refuses to truncate a long one', async () => {
  const env = { GITHUB_TOKEN: 't' };
  assert.equal((await withFetch([1, 2], () => githubList('/x', null, env))).length, 2);
  const full = Array.from({ length: 100 }, (_, i) => i);
  await assert.rejects(withFetch(full, () => githubList('/x', null, env)), new RegExp(`more than ${MAX_PAGES * 100} items`));
});

// --- rate limits (PR #2647: a CI gate read HTTP 403 while the repo's GITHUB_TOKEN budget was spent) ---

function answer(status, { headers = {}, body = {} } = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const res = { ok: status >= 200 && status < 300, status, headers: { get: (k) => h.get(k.toLowerCase()) ?? null }, json: async () => body };
  res.clone = () => res;
  return res;
}

async function withAnswers(answers, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init?.method });
    return answers.shift();
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test('rateLimitOf: a plain 403 or 404 is not a rate limit', async () => {
  assert.equal(await rateLimitOf(answer(403, { body: { message: 'Resource not accessible by integration' } })), null);
  assert.equal(await rateLimitOf(answer(404)), null);
});

test('rateLimitOf: primary limit waits until the reset; secondary uses Retry-After; 429 counts', async () => {
  const now = Date.parse('2026-11-23T21:10:00Z');
  const primary = await rateLimitOf(answer(403, { headers: { 'x-ratelimit-remaining': 0, 'x-ratelimit-reset': now / 1000 + 90 }, body: { message: 'API rate limit exceeded' } }), now);
  assert.equal(primary.waitMs, 90_000);
  assert.match(primary.why, /remaining=0/);
  assert.equal((await rateLimitOf(answer(403, { headers: { 'retry-after': 30 } }), now)).waitMs, 30_000);
  assert.equal((await rateLimitOf(answer(403, { body: { message: 'You have exceeded a secondary rate limit' } }), now)).waitMs, 60_000);
  assert.equal((await rateLimitOf(answer(429), now)).waitMs, 60_000);
});

test('githubFetch waits out a short rate limit and then returns the answer', async () => {
  const slept = [];
  const env = { GITHUB_TOKEN: 't' };
  const out = await withAnswers([answer(403, { headers: { 'retry-after': 5 } }), answer(200, { body: { ok: 1 } })], (calls) =>
    githubFetch('GET', '/x', {}, env, async (ms) => slept.push(ms)).then((r) => ({ r, n: calls.length })),
  );
  assert.deepEqual(out, { r: { ok: 1 }, n: 2 });
  assert.deepEqual(slept, [6000]);
});

test('githubFetch fails closed when the rate limit outlasts the budget, and never retries other errors', async () => {
  const env = { GITHUB_TOKEN: 't', CI_GITHUB_RATE_LIMIT_MAX_WAIT_MIN: '1' };
  await withAnswers([answer(403, { headers: { 'retry-after': 600 } })], () =>
    assert.rejects(githubFetch('GET', '/x', {}, env, async () => {}), /HTTP 403 \(rate limit: .*waited 0 s of 60 s\)/),
  );
  await withAnswers([answer(403, { body: { message: 'Resource not accessible by integration' } })], (calls) =>
    assert.rejects(githubFetch('GET', '/y', {}, env, async () => assert.fail('must not sleep')), /GitHub API GET \/y answered HTTP 403$/).then(() => assert.equal(calls.length, 1)),
  );
});
