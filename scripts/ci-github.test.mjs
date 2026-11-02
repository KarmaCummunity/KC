// Unit tests for scripts/ci-github.mjs. Run: node --test scripts/ci-github.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_PAGES, findOwnerOverride, githubList, laneResults, ownerApproval, parseOwners } from './ci-github.mjs';

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

test('no override outside a PR or merge-group event, without calling the API', async () => {
  const r = await findOwnerOverride({ EVENT_NAME: 'push', PR_NUMBER: '' }, 'HEAD');
  assert.equal(r.login, null);
  assert.match(r.why, /push run has no PR review/);
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

// ── merge queue (TD-252): the override is the approval of the PR the queue entry carries

// A repository shaped like the queue: a base commit holding the owners file,
// then one squash commit `feat: x (#7)` stacked on it.
const queueDir = mkdtempSync(join(tmpdir(), 'ci-github-queue-'));
const qgit = (...args) => execFileSync('git', args, { cwd: queueDir, encoding: 'utf8' }).trim();
qgit('init', '-q');
mkdirSync(join(queueDir, '.github'));
writeFileSync(join(queueDir, '.github/owners.json'), JSON.stringify({ owners: ['navesarussi'] }));
qgit('add', '.');
qgit('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
const QBASE = qgit('rev-parse', 'HEAD');
writeFileSync(join(queueDir, 'f.txt'), 'x');
qgit('add', '.');
qgit('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'feat: x (#7)');
const QHEAD = qgit('rev-parse', 'HEAD');
process.on('exit', () => rmSync(queueDir, { recursive: true, force: true }));

const PR_HEAD = 'c'.repeat(40);
const queueEnv = {
  EVENT_NAME: 'merge_group',
  BASE_SHA: QBASE,
  HEAD_SHA: QHEAD,
  HEAD_REF: `refs/heads/gh-readonly-queue/dev/pr-7-${QBASE}`,
  GITHUB_REPOSITORY: 'o/r',
  GITHUB_TOKEN: 't',
};
const openPr = (over = {}) => ({ state: 'open', base: { ref: 'dev' }, user: { login: 'agent-bot' }, head: { sha: PR_HEAD }, ...over });

/** Run `fn` with global fetch answering by URL path; records every path asked. */
async function withRoutes(routes, fn) {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    asked.push(path);
    return path in routes ? { ok: true, json: async () => routes[path] } : { ok: false, status: 404 };
  };
  try {
    return await fn(asked);
  } finally {
    globalThis.fetch = real;
  }
}
const queueRoutes = (pr, reviews) => ({ '/repos/o/r/pulls/7': pr, '/repos/o/r/pulls/7/reviews': reviews });

test('a merge-queue entry passes on the owner approval of the PR it carries', async () => {
  const r = await withRoutes(queueRoutes(openPr(), [review('navesarussi', 'APPROVED', PR_HEAD)]), () => findOwnerOverride(queueEnv, QBASE, queueDir));
  assert.deepEqual(r, { login: 'navesarussi', number: 7, headSha: PR_HEAD });
});

test('a merge-queue entry without an approval stays red and names the PR', async () => {
  const r = await withRoutes(queueRoutes(openPr(), []), () => findOwnerOverride(queueEnv, QBASE, queueDir));
  assert.equal(r.login, null);
  assert.match(r.why, /no approving review by @navesarussi on head c+ of PR #7/);
});

test('an approval on an older head of the queued PR does not count', async () => {
  const r = await withRoutes(queueRoutes(openPr(), [review('navesarussi', 'APPROVED', OLD)]), () => findOwnerOverride(queueEnv, QBASE, queueDir));
  assert.equal(r.login, null);
});

test('the author of the queued PR cannot approve it', async () => {
  const pr = openPr({ user: { login: 'navesarussi' } });
  const r = await withRoutes(queueRoutes(pr, [review('navesarussi', 'APPROVED', PR_HEAD)]), () => findOwnerOverride(queueEnv, QBASE, queueDir));
  assert.equal(r.login, null);
});

test('a queued PR that is not open, or targets another branch, gets no override', async () => {
  for (const pr of [openPr({ state: 'closed' }), openPr({ base: { ref: 'main' } })]) {
    const r = await withRoutes(queueRoutes(pr, [review('navesarussi', 'APPROVED', PR_HEAD)]), () => findOwnerOverride(queueEnv, QBASE, queueDir));
    assert.equal(r.login, null);
    assert.match(r.why, /merge queue: PR #7 is not open against dev/);
  }
});

test('a merge group that cannot be tied to one PR gets no override and asks the API nothing', async () => {
  const env = { ...queueEnv, HEAD_REF: 'refs/heads/dev' };
  const asked = await withRoutes({}, async (calls) => {
    const r = await findOwnerOverride(env, QBASE, queueDir);
    assert.equal(r.login, null);
    assert.match(r.why, /^merge queue: head ref "refs\/heads\/dev" is not a merge-queue branch/);
    return calls;
  });
  assert.deepEqual(asked, []);
});

test('a pull_request run still judges the PR from its own environment', async () => {
  const env = { EVENT_NAME: 'pull_request', PR_NUMBER: '7', PR_AUTHOR: 'agent-bot', HEAD_SHA: HEAD, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' };
  const r = await withRoutes({ '/repos/o/r/pulls/7/reviews': [review('navesarussi', 'APPROVED', HEAD)] }, (asked) => findOwnerOverride(env, QBASE, queueDir).then((res) => ({ res, asked })));
  assert.deepEqual(r.res, { login: 'navesarussi', number: '7', headSha: HEAD });
  assert.deepEqual(r.asked, ['/repos/o/r/pulls/7/reviews']);
});
