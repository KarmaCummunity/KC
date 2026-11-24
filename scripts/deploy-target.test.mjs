// Unit tests for scripts/deploy-target.mjs. Run: node --test scripts/deploy-target.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TRIGGER_WORKFLOWS,
  chooseDeploy,
  findGatedRun,
  findReleasePr,
  resolveTarget,
} from './deploy-target.mjs';

const SHA = 'a'.repeat(40);
const RUN_SHA = 'b'.repeat(40);
const REPO = 'KarmaCummunity/KC';
const pushRun = (branch, path = '.github/workflows/ci.yml') => ({
  event: 'push',
  conclusion: 'success',
  head_branch: branch,
  head_sha: RUN_SHA,
  head_repository: { full_name: REPO },
  path,
});

test('a successful dev push CI run deploys its own head SHA to dev', () => {
  const r = resolveTarget({ event: 'workflow_run', ref: 'refs/heads/main', repo: REPO, sha: SHA, workflowRun: pushRun('dev') });
  assert.deepEqual(r, { branch: 'dev', sha: RUN_SHA, target: 'dev', trigger: 'ci' });
});

test('main maps to prod', () => {
  assert.equal(resolveTarget({ event: 'workflow_run', ref: 'refs/heads/main', repo: REPO, sha: SHA, workflowRun: pushRun('main') }).target, 'prod');
});

test('PR-event or failed CI runs never deploy', () => {
  const pr = { ...pushRun('dev'), event: 'pull_request' };
  assert.throws(() => resolveTarget({ event: 'workflow_run', ref: 'refs/heads/main', workflowRun: pr }), /only successful pushes deploy/);
  const failed = { ...pushRun('dev'), conclusion: 'failure' };
  assert.throws(() => resolveTarget({ event: 'workflow_run', ref: 'refs/heads/main', workflowRun: failed }), /only successful pushes/);
});

test('a dispatch deploys the dispatched ref SHA, from dev or main only', () => {
  assert.deepEqual(resolveTarget({ event: 'workflow_dispatch', ref: 'refs/heads/main', sha: SHA }), {
    branch: 'main',
    sha: SHA,
    target: 'prod',
    trigger: 'dispatch',
  });
  assert.throws(() => resolveTarget({ event: 'workflow_dispatch', ref: 'refs/heads/feat/x', sha: SHA }), /only dev and main deploy/);
  assert.throws(() => resolveTarget({ event: 'workflow_dispatch', ref: 'refs/tags/main', sha: SHA }), /only dev and main deploy/);
});

test('other events and malformed SHAs are refused', () => {
  assert.throws(() => resolveTarget({ event: 'push', ref: 'refs/heads/main', sha: SHA }), /only dev deploys on push/);
  assert.throws(() => resolveTarget({ event: 'pull_request', ref: 'refs/heads/dev', sha: SHA }), /cannot run on pull_request/);
  assert.deepEqual(resolveTarget({ event: 'push', ref: 'refs/heads/dev', sha: SHA }), { branch: 'dev', sha: SHA, target: 'dev', trigger: 'dispatch' });
  assert.throws(() => resolveTarget({ event: 'workflow_dispatch', ref: 'refs/heads/dev', sha: 'abc' }), /not a commit SHA/);
});

test('findGatedRun needs a successful push run whose CI gate job succeeded', async () => {
  const jobs = {
    1: [{ name: 'CI gate', conclusion: 'success' }],
    2: [{ name: 'CI gate', conclusion: 'failure' }],
    3: [{ name: 'frontend / quality', conclusion: 'success' }],
  };
  const jobsOf = async (id) => jobs[id];
  const run = (id, extra = {}) => ({ id, event: 'push', conclusion: 'success', ...extra });
  assert.equal(await findGatedRun([run(3), run(1)], jobsOf), 1);
  assert.equal(await findGatedRun([run(2), run(3)], jobsOf), null);
  assert.equal(await findGatedRun([run(1, { event: 'pull_request' })], jobsOf), null);
  assert.equal(await findGatedRun([run(1, { conclusion: 'failure' })], jobsOf), null);
  assert.equal(await findGatedRun([], jobsOf), null);
});

test('a CI run from another repository never deploys', () => {
  const forked = { ...pushRun('main'), head_repository: { full_name: 'evil/KC' } };
  assert.throws(() => resolveTarget({ event: 'workflow_run', ref: 'refs/heads/main', repo: REPO, workflowRun: forked }), /came from evil\/KC/);
});

test('findReleasePr needs a merged dev → main PR of this repo whose merge commit is the SHA', () => {
  const pr = {
    number: 7,
    merged_at: '2026-10-30T00:00:00Z',
    merge_commit_sha: SHA,
    base: { ref: 'main', repo: { full_name: REPO } },
    head: { ref: 'dev', repo: { full_name: REPO } },
  };
  assert.equal(findReleasePr([pr], { repo: REPO, sha: SHA }), 7);
  assert.equal(findReleasePr([{ ...pr, merged_at: null }], { repo: REPO, sha: SHA }), null);
  assert.equal(findReleasePr([{ ...pr, merge_commit_sha: RUN_SHA }], { repo: REPO, sha: SHA }), null);
  assert.equal(findReleasePr([{ ...pr, head: { ref: 'feat/x', repo: { full_name: REPO } } }], { repo: REPO, sha: SHA }), null);
  assert.equal(findReleasePr([{ ...pr, head: { ref: 'dev', repo: { full_name: 'fork/KC' } } }], { repo: REPO, sha: SHA }), null);
  assert.equal(findReleasePr([], { repo: REPO, sha: SHA }), null);
});

// ── Deploy decision (no version-bump inheritance since #2613) ─────────────

const MERGE = 'c'.repeat(40); // the judged commit
const NEWER = 'd'.repeat(40); // a newer tip
const gatedRunOf = (gated) => async (sha) => (gated.includes(sha) ? 42 : null);
const base = { sha: MERGE, branch: 'dev' };

test('only ci.yml runs can wake the deploy; the old bump workflow is refused', () => {
  assert.deepEqual(Object.keys(TRIGGER_WORKFLOWS), ['.github/workflows/ci.yml']);
  for (const path of ['.github/workflows/bump-version-on-merge.yml', '.github/workflows/not-ci.yml']) {
    assert.throws(() => resolveTarget({ event: 'workflow_run', ref: 'refs/heads/main', repo: REPO, workflowRun: pushRun('dev', path) }), /cannot trigger a deploy/);
  }
});

test('the gated tip deploys itself', async () => {
  assert.deepEqual(await chooseDeploy({ ...base, tip: MERGE }, { gatedRunOf: gatedRunOf([MERGE]) }), { deploy: true, sha: MERGE, runId: 42 });
});

test('a newer tip is "moved on", on dev and main alike (no bump child is ever deployed)', async () => {
  for (const branch of ['dev', 'main']) {
    const r = await chooseDeploy({ ...base, branch, tip: NEWER }, { gatedRunOf: gatedRunOf([MERGE, NEWER]) });
    assert.equal(r.deploy, false);
    assert.match(r.reason, /has moved on/);
  }
});

test('an ungated tip is refused, whatever its shape (a former [skip ci] bump too)', async () => {
  await assert.rejects(chooseDeploy({ ...base, tip: MERGE }, { gatedRunOf: gatedRunOf([]) }), /refusing to deploy/);
});

test('deploy.yml no longer wakes on the bump workflow', () => {
  const wf = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(wf, /workflow_run:\n\s+workflows: \[CI\]\n/);
});

test('findGatedRun with branches counts only runs on those branches', async () => {
  const jobsOf = async () => [{ name: 'CI gate', conclusion: 'success' }];
  const run = { id: 9, event: 'push', conclusion: 'success', head_branch: 'feat/x' };
  assert.equal(await findGatedRun([run], jobsOf, new Set(['dev', 'main'])), null);
  assert.equal(await findGatedRun([{ ...run, head_branch: 'dev' }], jobsOf, new Set(['dev', 'main'])), 9);
});
