// Unit tests for scripts/ci-run-binding.mjs. Run: node --test scripts/ci-run-binding.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attemptErrors,
  bindPrRun,
  gateFilesChanged,
  mergeRefOf,
  newestPrRun,
  prMismatchErrors,
  runShapeErrors,
  siblingPrErrors,
} from './ci-run-binding.mjs';

const REPO = 'Org/KC';
const HEAD = 'h'.repeat(40);
const MERGE = 'm'.repeat(40);
const BASE = 'b'.repeat(40);
const TIP = 't'.repeat(40);
const ENV = { GITHUB_TOKEN: 't' };

const ref = (file, pr = 7, sha = MERGE, repo = REPO) => ({
  path: `${repo}/.github/workflows/${file}@refs/pull/${pr}/merge`,
  sha,
  ref: `refs/pull/${pr}/merge`,
});

/** A completed pull_request run of PR #7 (branch feat/x) whose reusable workflows ran at MERGE. */
function prRun(overrides = {}) {
  return {
    id: 1,
    run_attempt: 1,
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    path: '.github/workflows/ci.yml',
    head_sha: HEAD,
    head_branch: 'feat/x',
    html_url: 'https://github.com/Org/KC/actions/runs/1',
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
    referenced_workflows: [ref('ci-static-guards.yml'), ref('ci-pr.yml')],
    ...overrides,
  };
}

const prObject = (number, baseRef, { headRef = 'feat/x', sha = HEAD } = {}) => ({
  number,
  base: { ref: baseRef, repo: { full_name: REPO } },
  head: { ref: headRef, sha, repo: { full_name: REPO } },
});

/** API answers for PR #7 into `baseRef` whose merge commit merges HEAD onto BASE. */
function api({ baseRef = 'dev', pr = prObject(7, baseRef), siblings = [pr], parents = [BASE, HEAD], status = 'ahead', files = [] } = {}) {
  return {
    [`/repos/${REPO}/pulls/7`]: pr,
    [`/repos/${REPO}/pulls`]: siblings,
    [`/repos/${REPO}/commits/${MERGE}`]: { parents: parents.map((sha) => ({ sha })) },
    [`/repos/${REPO}/branches/${baseRef}`]: { commit: { sha: TIP } },
    [`/repos/${REPO}/compare/${BASE}...${TIP}`]: { status, files },
  };
}

/** Run `fn` with global fetch serving `routes` (path → JSON; query ignored). */
async function withApi(routes, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (!(path in routes)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => routes[path] };
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test('a well-formed PR run has no shape errors', () => {
  assert.deepEqual(runShapeErrors(prRun(), REPO), []);
});

test('look-alike workflows, forks and unfinished runs are rejected', () => {
  assert.match(runShapeErrors(prRun({ path: '.github/workflows/evil.yml' }), REPO)[0], /not \.github\/workflows\/ci\.yml/);
  assert.match(runShapeErrors(prRun({ head_repository: { full_name: 'fork/KC' } }), REPO)[0], /fork/);
  assert.match(runShapeErrors(prRun({ status: 'in_progress' }), REPO)[0], /in_progress/);
});

test('push and dispatch runs count only on dev or main; merge groups only on their queues', () => {
  assert.deepEqual(runShapeErrors(prRun({ event: 'push', head_branch: 'dev' }), REPO), []);
  assert.equal(runShapeErrors(prRun({ event: 'push', head_branch: 'x' }), REPO).length, 1);
  assert.equal(runShapeErrors(prRun({ event: 'workflow_dispatch', head_branch: 'feat/y' }), REPO).length, 1);
  assert.deepEqual(runShapeErrors(prRun({ event: 'merge_group', head_branch: 'gh-readonly-queue/main/pr-7-abc' }), REPO), []);
  assert.equal(runShapeErrors(prRun({ event: 'merge_group', head_branch: 'gh-readonly-queue/x/pr-7' }), REPO).length, 1);
  assert.equal(runShapeErrors(prRun({ event: 'schedule' }), REPO).length, 1);
});

test('mergeRefOf needs every reference to be this repo at one refs/pull/N/merge commit', () => {
  assert.deepEqual(mergeRefOf(prRun(), REPO), { sha: MERGE, pr: 7 });
  assert.equal(mergeRefOf(prRun({ referenced_workflows: [] }), REPO), null);
  assert.equal(mergeRefOf(prRun({ referenced_workflows: [ref('a.yml'), ref('b.yml', 7, BASE)] }), REPO), null, 'two commits');
  assert.equal(mergeRefOf(prRun({ referenced_workflows: [ref('a.yml'), ref('b.yml', 8)] }), REPO), null, 'two PR refs');
  assert.equal(mergeRefOf(prRun({ referenced_workflows: [ref('a.yml'), ref('b.yml', 7, MERGE, 'evil/repo')] }), REPO), null, 'other repo');
  const branchRef = { path: `${REPO}/.github/workflows/ci-pr.yml@refs/heads/x`, sha: MERGE, ref: 'refs/heads/x' };
  assert.equal(mergeRefOf(prRun({ referenced_workflows: [branchRef] }), REPO), null, 'branch ref');
  const mislabelled = { ...ref('ci-pr.yml'), ref: 'refs/pull/8/merge' };
  assert.equal(mergeRefOf(prRun({ referenced_workflows: [mislabelled] }), REPO), null, 'ref disagrees with path');
});

test('gateFilesChanged picks workflow and judge files only', () => {
  const files = ['.github/workflows/ci.yml', 'scripts/ci-gate.mjs', 'scripts/check-x.mjs', 'app/a.ts'].map((filename) => ({ filename }));
  assert.deepEqual(gateFilesChanged(files), ['.github/workflows/ci.yml', 'scripts/ci-gate.mjs', 'scripts/check-x.mjs']);
});

test('bindPrRun binds a run of a PR into dev', async () => {
  const { errors, pr } = await withApi(api(), () => bindPrRun(prRun(), REPO, ENV, { pr: 7, baseRef: 'dev' }));
  assert.deepEqual(errors, []);
  assert.equal(pr.number, 7);
});

test('bindPrRun rejects a PR into an unprotected branch', async () => {
  const { errors } = await withApi(api({ baseRef: 'attacker' }), () => bindPrRun(prRun(), REPO, ENV));
  assert.match(errors[0], /targets attacker, not dev or main/);
});

test('forged merge refs: a run from another branch that calls PR #7 merge ref is rejected', async () => {
  // The attacker's ci.yml on branch x calls `Org/KC/.github/workflows/*.yml@refs/pull/7/merge`
  // and runs for PR #9 (attack-branch → x); GitHub records the forged references.
  const forged = prRun({ head_branch: 'attack-branch' });
  const { errors } = await withApi(api(), () => bindPrRun(forged, REPO, ENV));
  assert.match(errors[0], /head branch is feat\/x, but the run built attack-branch/);
});

test('forged merge refs: a sibling PR from the same branch and commit into another base is rejected', async () => {
  const siblings = [prObject(7, 'dev'), prObject(9, 'x')];
  const { errors } = await withApi(api({ siblings }), () => bindPrRun(prRun(), REPO, ENV));
  assert.match(errors[0], /PR #9 also proposes .* into x/);
});

test('an old sibling PR from the same branch at another commit does not block', async () => {
  const siblings = [prObject(7, 'dev'), prObject(3, 'staging', { sha: BASE })];
  assert.deepEqual((await withApi(api({ siblings }), () => bindPrRun(prRun(), REPO, ENV))).errors, []);
});

test('bindPrRun rejects another PR, another base, a moved head, a foreign merge and a stale base', async () => {
  assert.match((await withApi(api(), () => bindPrRun(prRun(), REPO, ENV, { pr: 8 }))).errors[0], /PR #7, not PR #8/);
  assert.match((await withApi(api(), () => bindPrRun(prRun(), REPO, ENV, { baseRef: 'main' }))).errors[0], /not main/);
  const moved = api({ pr: prObject(7, 'dev', { sha: BASE }) });
  assert.match((await withApi(moved, () => bindPrRun(prRun(), REPO, ENV))).errors[0], /but the run built hhhh/);
  assert.match((await withApi(api({ parents: [BASE, MERGE] }), () => bindPrRun(prRun(), REPO, ENV))).errors[0], /does not merge head/);
  assert.match((await withApi(api({ status: 'diverged' }), () => bindPrRun(prRun(), REPO, ENV))).errors[0], /not part of dev/);
  const gate = api({ files: [{ filename: '.github/workflows/ci.yml' }] });
  assert.match((await withApi(gate, () => bindPrRun(prRun(), REPO, ENV))).errors[0], /changed gate files/);
});

test('bindPrRun rejects a run without merge references before calling the API', async () => {
  const { errors } = await withApi({}, () => bindPrRun(prRun({ referenced_workflows: [] }), REPO, ENV));
  assert.match(errors[0], /one refs\/pull\/N\/merge commit/);
});

test('prMismatchErrors and siblingPrErrors are pure checks of the PR objects', () => {
  assert.deepEqual(prMismatchErrors(prObject(7, 'main'), prRun(), REPO), []);
  assert.equal(prMismatchErrors({ ...prObject(7, 'dev'), head: { ref: 'feat/x', sha: HEAD, repo: { full_name: 'fork/KC' } } }, prRun(), REPO).length, 1);
  assert.deepEqual(siblingPrErrors([prObject(7, 'dev'), prObject(8, 'main')], prRun(), REPO), []);
});

test('attemptErrors rejects jobs kept from an earlier attempt (partial re-run)', () => {
  const run = { run_attempt: 2 };
  assert.deepEqual(attemptErrors(run, [{ name: 'CI gate', run_attempt: 2 }]), []);
  assert.match(attemptErrors(run, [{ name: 'CI gate', run_attempt: 2 }, { name: 'static / test integrity', run_attempt: 1 }])[0], /static \/ test integrity/);
});

test('newestPrRun picks the newest PR or review run, ignoring pushes', () => {
  const run = (id, created, event = 'pull_request') => ({ id, created_at: created, event });
  const runs = [run(1, '2026-10-30T10:00:00Z'), run(2, '2026-10-30T11:00:00Z', 'pull_request_review'), run(3, '2026-10-30T12:00:00Z', 'push')];
  assert.equal(newestPrRun(runs).id, 2);
  assert.equal(newestPrRun([run(3, '2026-10-30T12:00:00Z', 'push')]), null);
});
