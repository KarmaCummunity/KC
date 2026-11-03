// Unit tests for scripts/ci-run-reuse.mjs. Run: node --test scripts/ci-run-reuse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestPullRequestRun, reusedLaneResults } from './ci-run-reuse.mjs';

const REPO = 'Org/KC';
const HEAD = 'h'.repeat(40);
const MERGE = 'm'.repeat(40);
const BASE = 'b'.repeat(40);
const TIP = 't'.repeat(40);
const ENV = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: REPO, HEAD_SHA: HEAD, PR_NUMBER: '7', BASE_REF: 'dev' };

const pr7 = { number: 7, base: { ref: 'dev', repo: { full_name: REPO } }, head: { ref: 'feat/x', sha: HEAD, repo: { full_name: REPO } } };
const run = {
  id: 1,
  run_attempt: 2,
  event: 'pull_request',
  status: 'completed',
  created_at: '2026-10-30T10:00:00Z',
  head_sha: HEAD,
  head_branch: 'feat/x',
  html_url: 'https://github.com/Org/KC/actions/runs/1',
  pull_requests: [{ number: 7, base: { ref: 'dev' } }],
  referenced_workflows: [{ path: `${REPO}/.github/workflows/ci-pr.yml@refs/pull/7/merge`, sha: MERGE, ref: 'refs/pull/7/merge' }],
};

/** Serve the reuse lookups; `jobs` are run 1's jobs. */
async function withApi(jobs, fn) {
  const routes = {
    [`/repos/${REPO}/actions/workflows/ci.yml/runs`]: { workflow_runs: [run] },
    [`/repos/${REPO}/pulls/7`]: pr7,
    [`/repos/${REPO}/pulls`]: [pr7],
    [`/repos/${REPO}/commits/${MERGE}`]: { parents: [{ sha: BASE }, { sha: HEAD }] },
    [`/repos/${REPO}/branches/dev`]: { commit: { sha: TIP } },
    [`/repos/${REPO}/compare/${BASE}...${TIP}`]: { status: 'ahead', files: [] },
    [`/repos/${REPO}/actions/runs/1/jobs`]: { jobs },
  };
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    return path in routes ? { ok: true, json: async () => routes[path] } : { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const job = (name, run_attempt = 2) => ({ name, run_attempt, status: 'completed', conclusion: 'success' });

test('reuses the lane results of a bound, single-attempt run', async () => {
  const { results } = await withApi([job('frontend / quality'), job('static / static guards')], () =>
    reusedLaneResults(ENV, ['frontend', 'static'], { waitMs: 0 }),
  );
  assert.deepEqual(results, { frontend: 'success', static: 'success' });
});

test('refuses a run whose jobs mix attempts (a partial re-run)', async () => {
  const jobs = [job('frontend / quality'), job('static / test integrity', 1)];
  await assert.rejects(withApi(jobs, () => reusedLaneResults(ENV, ['frontend'], { waitMs: 0 })), /earlier attempt/);
});

test('refuses a run of another base', async () => {
  await assert.rejects(withApi([], () => reusedLaneResults({ ...ENV, BASE_REF: 'main' }, ['frontend'], { waitMs: 0 })), /no pull_request CI run/);
});

test('latestPullRequestRun picks the newest pull_request run listed for the same PR and base', () => {
  const r = (id, created, { event = 'pull_request', pr = 7, base = 'dev' } = {}) => ({
    id,
    created_at: created,
    event,
    pull_requests: [{ number: pr, base: { ref: base } }],
  });
  const runs = [
    r(1, '2026-10-30T10:00:00Z'),
    r(2, '2026-10-30T11:00:00Z'),
    r(3, '2026-10-30T12:00:00Z', { event: 'pull_request_review' }),
    r(4, '2026-10-30T13:00:00Z', { pr: 8 }),
    r(5, '2026-10-30T14:00:00Z', { base: 'attacker' }),
  ];
  assert.equal(latestPullRequestRun(runs, 7, 'dev').id, 2);
  assert.equal(latestPullRequestRun(runs, 7, 'main'), null);
  assert.equal(latestPullRequestRun([{ ...r(6, '2026-10-30T10:00:00Z'), pull_requests: [] }], 7, 'dev'), null);
});
