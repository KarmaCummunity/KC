// Unit tests for scripts/ci-gate.mjs. Run: node --test scripts/ci-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deferralErrors, evaluateGate, mergeReused } from './ci-gate.mjs';

const ok = { result: 'success' };
const skipped = { result: 'skipped' };
const PR = { draft: false, event: 'pull_request', ref: 'refs/pull/1/merge' };
const PLAN = { hygiene: true, static: true, frontend: true, backend: false, edge: false };
const NEEDS = { changes: ok, hygiene: ok, static: ok, frontend: ok, backend: skipped, edge: skipped };

test('passes when every needed lane succeeded and the rest were explicitly not needed', () => {
  assert.deepEqual(evaluateGate({ ...PR, needs: NEEDS, plan: PLAN }), []);
});

test('fails a draft PR even when nothing ran', () => {
  const errors = evaluateGate({ ...PR, draft: true, needs: { changes: ok }, plan: null });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Draft PR/);
});

test('fails when a needed lane was skipped', () => {
  const errors = evaluateGate({ ...PR, needs: { ...NEEDS, frontend: skipped }, plan: PLAN });
  assert.deepEqual(errors, ['job "frontend" is needed for this change but was skipped']);
});

test('fails on any failed or cancelled job, needed or not', () => {
  const needs = { ...NEEDS, backend: { result: 'failure' }, edge: { result: 'cancelled' } };
  assert.deepEqual(evaluateGate({ ...PR, needs, plan: PLAN }), ['job "backend" failure', 'job "edge" cancelled']);
});

test('fails closed when the plan is missing or empty', () => {
  for (const plan of [null, {}]) {
    assert.deepEqual(evaluateGate({ ...PR, needs: NEEDS, plan }), ['change detector produced no lane plan']);
  }
});

test('fails when a skipped lane is absent from the plan', () => {
  const { edge: _edge, ...partial } = PLAN;
  assert.deepEqual(evaluateGate({ ...PR, needs: NEEDS, plan: partial }), [
    'job "edge" is not in the change detector\'s plan',
  ]);
});

test('an optional lane left out of the plan may only be skipped', () => {
  assert.deepEqual(evaluateGate({ ...PR, needs: { ...NEEDS, release: skipped }, plan: PLAN }), []);
  assert.deepEqual(evaluateGate({ ...PR, needs: { ...NEEDS, release: ok }, plan: PLAN }), [
    'job "release" is not in the change detector\'s plan',
  ]);
});

test('a release into main cannot pass with the release lane skipped or unwired', () => {
  const plan = { ...PLAN, release: true };
  assert.deepEqual(evaluateGate({ ...PR, needs: { ...NEEDS, release: skipped }, plan }), [
    'job "release" is needed for this change but was skipped',
  ]);
  assert.deepEqual(evaluateGate({ ...PR, needs: NEEDS, plan }), ['job "release" is planned but missing from the gate\'s needs: list']);
  assert.deepEqual(evaluateGate({ ...PR, needs: { ...NEEDS, release: ok }, plan }), []);
});

test('fails when a planned lane is not wired into needs', () => {
  const { edge: _edge, ...needs } = NEEDS;
  assert.deepEqual(evaluateGate({ ...PR, needs, plan: PLAN }), [
    'job "edge" is planned but missing from the gate\'s needs: list',
  ]);
});

test('fails when the change detector did not succeed', () => {
  const errors = evaluateGate({ ...PR, needs: { changes: { result: 'failure' } }, plan: null });
  assert.deepEqual(errors, ['change detector did not succeed (result: failure)']);
});

test('manual dispatch gates only dev and main', () => {
  const all = { hygiene: false, static: true, frontend: true, backend: true, edge: true, bundles: true };
  const needs = { ...NEEDS, hygiene: skipped, backend: ok, edge: ok, bundles: ok };
  assert.deepEqual(evaluateGate({ needs, plan: all, draft: false, event: 'workflow_dispatch', ref: 'refs/heads/dev' }), []);
  const errors = evaluateGate({ needs, plan: all, draft: false, event: 'workflow_dispatch', ref: 'refs/heads/feat/x' });
  assert.match(errors[0], /Manual runs gate only dev or main/);
});

// Review events re-run only the static lane and reuse the rest. `release` is
// an optional lane: omitted from the plan, it is reused as skipped.
const REVIEW_PLAN = { hygiene: true, static: true, frontend: true, backend: false, edge: false, bundles: false };
const REVIEW_OWN = { changes: ok, hygiene: skipped, static: ok, release: skipped, frontend: skipped, backend: skipped, edge: skipped, bundles: skipped };
const REVIEW = { ...PR, event: 'pull_request_review', baseRef: 'dev' };

test('a review event judges reused lane results but keeps its own static result', () => {
  const reused = { hygiene: 'success', static: 'failure', release: 'skipped', frontend: 'success', backend: 'skipped', edge: 'skipped', bundles: 'skipped' };
  const merged = mergeReused(REVIEW_OWN, reused);
  assert.deepEqual(merged.static, ok);
  assert.deepEqual(merged.frontend, ok);
  assert.deepEqual(evaluateGate({ ...REVIEW, needs: merged, plan: REVIEW_PLAN }), []);
});

test('a review event fails when the reused run lacks or failed a needed lane', () => {
  const missing = mergeReused(REVIEW_OWN, { hygiene: 'success', release: 'skipped', backend: 'skipped', edge: 'skipped', bundles: 'skipped' });
  assert.deepEqual(evaluateGate({ ...REVIEW, needs: missing, plan: REVIEW_PLAN }), [
    'job "frontend" is needed for this change but ended missing',
  ]);
  const failed = mergeReused(REVIEW_OWN, { hygiene: 'success', release: 'skipped', frontend: 'failure', backend: 'skipped', edge: 'skipped', bundles: 'skipped' });
  assert.deepEqual(evaluateGate({ ...REVIEW, needs: failed, plan: REVIEW_PLAN }), ['job "frontend" failure']);
});

test('a review on a release PR needs the reused release lane to have passed', () => {
  const plan = { ...REVIEW_PLAN, release: true };
  const reused = { hygiene: 'success', frontend: 'success', backend: 'skipped', edge: 'skipped', bundles: 'skipped' };
  assert.deepEqual(evaluateGate({ ...REVIEW, needs: mergeReused(REVIEW_OWN, { ...reused, release: 'success' }), plan }), []);
  assert.deepEqual(evaluateGate({ ...REVIEW, needs: mergeReused(REVIEW_OWN, { ...reused, release: 'skipped' }), plan }), [
    'job "release" is needed for this change but was skipped',
  ]);
});

test('mergeReused leaves an optional lane alone when this ci.yml has no such job', () => {
  const { release: _release, ...own } = REVIEW_OWN;
  assert.equal('release' in mergeReused(own, { release: 'success' }), false);
});

// Heavy lanes (D-195 addendum: PR = fast feedback, merge queue = full gate).
// Only a PR (or review) into dev may plan them as not needed; merge groups,
// pushes and dispatches must run every lane.
const FULL = { hygiene: false, static: true, frontend: true, backend: true, edge: true, bundles: true };
const FULL_NEEDS = { changes: ok, hygiene: skipped, static: ok, frontend: ok, backend: ok, edge: ok, bundles: ok };
const DEV_PR = { ...PR, baseRef: 'dev' };

test('a PR into dev may skip a heavy lane the plan marks not needed', () => {
  const plan = { ...PLAN, bundles: false };
  assert.deepEqual(evaluateGate({ ...DEV_PR, needs: { ...NEEDS, bundles: skipped }, plan }), []);
  assert.deepEqual(evaluateGate({ ...DEV_PR, event: 'pull_request_review', needs: { ...NEEDS, bundles: skipped }, plan }), []);
});

test('a PR into main fails when a heavy lane is deferred for a frontend change', () => {
  const plan = { ...PLAN, bundles: false, release: true };
  const needs = { ...NEEDS, bundles: skipped, release: ok };
  assert.deepEqual(evaluateGate({ ...PR, baseRef: 'main', needs, plan }), [
    'job "bundles" is planned as not needed on a PR into main; only PRs into dev may leave it to the merge queue',
  ]);
  const docsOnly = { ...plan, frontend: false };
  assert.deepEqual(evaluateGate({ ...PR, baseRef: 'main', needs: { ...needs, frontend: skipped }, plan: docsOnly }), []);
});

test('a merge group or push fails when a heavy lane was skipped', () => {
  for (const event of ['merge_group', 'push']) {
    const run = { draft: false, event, ref: 'refs/heads/dev', baseRef: 'refs/heads/dev' };
    assert.deepEqual(evaluateGate({ ...run, needs: FULL_NEEDS, plan: FULL }), [], event);
    assert.deepEqual(evaluateGate({ ...run, needs: { ...FULL_NEEDS, bundles: skipped }, plan: FULL }), [
      'job "bundles" is needed for this change but was skipped',
    ]);
    assert.deepEqual(evaluateGate({ ...run, needs: { ...FULL_NEEDS, bundles: skipped }, plan: { ...FULL, bundles: false } }), [
      `job "bundles" must run on every ${event} run, but the plan marks it not needed`,
    ]);
  }
});

test('a merge group, push or dispatch fails when the plan defers any lane but hygiene', () => {
  for (const event of ['merge_group', 'push', 'workflow_dispatch']) {
    const run = { draft: false, event, ref: 'refs/heads/dev', baseRef: 'refs/heads/dev' };
    const plan = { ...FULL, backend: false };
    assert.deepEqual(evaluateGate({ ...run, needs: { ...FULL_NEEDS, backend: skipped }, plan }), [
      `job "backend" must run on every ${event} run, but the plan marks it not needed`,
    ]);
  }
});

test('a merge group fails when a wired heavy lane is left out of the plan', () => {
  const { bundles: _bundles, ...plan } = FULL;
  const errors = deferralErrors({ plan, event: 'merge_group', baseRef: 'refs/heads/dev' });
  assert.deepEqual(errors, ['job "bundles" must run on every merge_group run, but the plan leaves it out']);
});

test('a merge group fails when the heavy lane is neither planned nor wired', () => {
  const { bundles: _plan, ...plan } = FULL;
  const { bundles: _needs, ...needs } = FULL_NEEDS;
  assert.deepEqual(evaluateGate({ draft: false, event: 'merge_group', ref: 'refs/heads/gh-readonly-queue/dev/pr-1', baseRef: 'refs/heads/dev', needs, plan }), [
    'job "bundles" must run on every merge_group run, but the plan leaves it out',
  ]);
});

test('a review into dev reuses a skipped heavy lane the plan defers', () => {
  const own = REVIEW_OWN;
  const reused = { hygiene: 'success', release: 'skipped', frontend: 'success', backend: 'skipped', edge: 'skipped', bundles: 'skipped' };
  const plan = { ...REVIEW_PLAN, bundles: false };
  assert.deepEqual(evaluateGate({ ...REVIEW, baseRef: 'dev', needs: mergeReused(own, reused), plan }), []);
});

test('a wired heavy lane left out of the plan fails on every event, even when skipped', () => {
  const { bundles: _plan, ...plan } = FULL;
  const runs = [
    { draft: false, event: 'pull_request', ref: 'refs/pull/1/merge', baseRef: 'main' },
    { draft: false, event: 'pull_request', ref: 'refs/pull/1/merge', baseRef: 'dev' },
    { draft: false, event: 'merge_group', ref: 'refs/heads/gh-readonly-queue/dev/pr-1', baseRef: 'refs/heads/dev' },
    { draft: false, event: 'push', ref: 'refs/heads/dev', baseRef: '' },
  ];
  for (const run of runs) {
    const errors = evaluateGate({ ...run, needs: { ...FULL_NEEDS, bundles: skipped }, plan });
    assert.ok(errors.includes('job "bundles" is not in the change detector\'s plan'), `${run.event} ${run.baseRef}: ${errors.join(' | ')}`);
  }
});

test('a PR into dev skips a heavy lane only when the plan says false explicitly', () => {
  const needs = { ...NEEDS, bundles: skipped };
  assert.deepEqual(evaluateGate({ ...DEV_PR, needs, plan: { ...PLAN, bundles: false } }), []);
  assert.deepEqual(evaluateGate({ ...DEV_PR, needs, plan: PLAN }), ['job "bundles" is not in the change detector\'s plan']);
});
