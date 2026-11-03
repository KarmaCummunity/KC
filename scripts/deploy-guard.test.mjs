// Unit tests for scripts/deploy-guard.mjs. Run: node --test scripts/deploy-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAttempts, checkFreshness, checkWorkflowRef, hasProductionApproval } from './deploy-guard.mjs';

const REPO = 'KarmaCummunity/KC';
const SHA = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);

test('deploy.yml on main may deploy both targets', () => {
  const workflowRef = `${REPO}/.github/workflows/deploy.yml@refs/heads/main`;
  assert.deepEqual(checkWorkflowRef({ workflowRef, repo: REPO, target: 'prod' }), []);
  assert.deepEqual(checkWorkflowRef({ workflowRef, repo: REPO, target: 'dev' }), []);
});

test('deploy.yml dispatched from dev may deploy dev only', () => {
  const workflowRef = `${REPO}/.github/workflows/deploy.yml@refs/heads/dev`;
  assert.deepEqual(checkWorkflowRef({ workflowRef, repo: REPO, target: 'dev' }), []);
  assert.match(checkWorkflowRef({ workflowRef, repo: REPO, target: 'prod' })[0], /only from deploy\.yml on refs\/heads\/main/);
});

test('any other caller is refused, including a stage called directly or from another repo', () => {
  for (const workflowRef of [
    `${REPO}/.github/workflows/sneaky.yml@refs/heads/main`,
    `${REPO}/.github/workflows/deploy-web.yml@refs/heads/main`,
    `evil/KC/.github/workflows/deploy.yml@refs/heads/main`,
    '',
  ]) {
    assert.match(checkWorkflowRef({ workflowRef, repo: REPO, target: 'dev' })[0], /may only run inside/, workflowRef);
  }
});

test('the approval and the baseline must come from this run attempt', () => {
  assert.deepEqual(checkAttempts({ runAttempt: '2', approvedAttempt: '2' }), []);
  assert.deepEqual(checkAttempts({ runAttempt: '2', approvedAttempt: '2', baselineAttempt: '2' }), []);
  assert.match(checkAttempts({ runAttempt: '2', approvedAttempt: '1' })[0], /Re-run all jobs/);
  assert.match(checkAttempts({ runAttempt: '1', approvedAttempt: '' })[0], /approved in attempt \(none\)/);
  assert.match(checkAttempts({ runAttempt: '2', approvedAttempt: '2', baselineAttempt: '1' })[0], /baseline was recorded in attempt 1/);
});

test('only an approved review of production counts', () => {
  const review = (state, name) => ({ state, environments: [{ name }] });
  assert.equal(hasProductionApproval([review('approved', 'production')]), true);
  assert.equal(hasProductionApproval([review('rejected', 'production')]), false);
  assert.equal(hasProductionApproval([review('approved', 'supabase-prod')]), false);
  assert.equal(hasProductionApproval([]), false);
});

test('a release must be the main tip and not behind the latest tag', () => {
  assert.deepEqual(checkFreshness({ releaseSha: SHA, mainTip: SHA, latestTag: 'v1.5.5', compareStatus: 'ahead' }), []);
  assert.deepEqual(checkFreshness({ releaseSha: SHA, mainTip: SHA, latestTag: 'v1.5.6', compareStatus: 'identical' }), []);
  assert.deepEqual(checkFreshness({ releaseSha: SHA, mainTip: SHA, latestTag: null, compareStatus: null }), []);
  assert.match(checkFreshness({ releaseSha: SHA, mainTip: NEWER, latestTag: null })[0], /main has moved on/);
  assert.match(checkFreshness({ releaseSha: SHA, mainTip: SHA, latestTag: 'v1.6.0', compareStatus: 'behind' })[0], /newer than/);
});
