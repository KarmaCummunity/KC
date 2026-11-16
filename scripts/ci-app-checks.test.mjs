// Unit tests for scripts/ci-app-checks.mjs. Run: node --test scripts/ci-app-checks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ABSENT_GRACE_MS,
  APP_CHECKS,
  PENDING_WAIT_MS,
  appCheckErrors,
  appChecksFor,
  classifyAppCheck,
  judgeSnapshot,
} from './ci-app-checks.mjs';

const GG = APP_CHECKS.find((s) => s.id === 'gitguardian');
const SNYK = APP_CHECKS.find((s) => s.id === 'snyk');
const gg = (over = {}) => ({
  id: 1,
  name: 'GitGuardian Security Checks',
  app: { id: 46505, slug: 'gitguardian' },
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-11-16T08:00:00Z',
  ...over,
});
const snyk = (over = {}) => ({
  id: 1,
  context: 'security/snyk (navesarussi)',
  state: 'success',
  creator: { login: 'navesarussi', type: 'User' },
  updated_at: '2026-11-16T08:00:00Z',
  ...over,
});

test('GitGuardian: success, neutral and skipped pass; failures fail', () => {
  for (const c of ['success', 'neutral', 'skipped']) assert.equal(classifyAppCheck(GG, { checkRuns: [gg({ conclusion: c })] }).state, 'ok');
  for (const c of ['failure', 'cancelled', 'timed_out', 'action_required', 'stale'])
    assert.equal(classifyAppCheck(GG, { checkRuns: [gg({ conclusion: c })] }).state, 'failed');
  assert.equal(classifyAppCheck(GG, { checkRuns: [gg({ status: 'queued', conclusion: null })] }).state, 'pending');
});

test('GitGuardian: a same-named check from another App (e.g. a workflow) is ignored', () => {
  const fake = gg({ app: { id: 15368, slug: 'github-actions' }, conclusion: 'success' });
  assert.equal(classifyAppCheck(GG, { checkRuns: [fake] }).state, 'absent');
  // and cannot mask a real failure
  const real = gg({ id: 2, conclusion: 'failure', started_at: '2026-11-16T07:00:00Z' });
  assert.equal(classifyAppCheck(GG, { checkRuns: [fake, real] }).state, 'failed');
});

test('GitGuardian: the newest run of the App decides', () => {
  const old = gg({ id: 1, conclusion: 'failure', started_at: '2026-11-16T07:00:00Z' });
  const rerun = gg({ id: 2, conclusion: 'success', started_at: '2026-11-16T08:00:00Z' });
  assert.equal(classifyAppCheck(GG, { checkRuns: [old, rerun] }).state, 'ok');
});

test('Snyk: status states map to ok / failed / pending', () => {
  assert.equal(classifyAppCheck(SNYK, { statuses: [snyk()] }).state, 'ok');
  assert.equal(classifyAppCheck(SNYK, { statuses: [snyk({ state: 'failure' })] }).state, 'failed');
  assert.equal(classifyAppCheck(SNYK, { statuses: [snyk({ state: 'error' })] }).state, 'failed');
  assert.equal(classifyAppCheck(SNYK, { statuses: [snyk({ state: 'pending' })] }).state, 'pending');
});

test('Snyk: a status posted by a workflow or a non-allowlisted user is ignored', () => {
  const bot = snyk({ creator: { login: 'github-actions[bot]', type: 'Bot' }, state: 'success' });
  const stranger = snyk({ context: 'security/snyk (mallory)', creator: { login: 'mallory', type: 'User' } });
  const mismatch = snyk({ creator: { login: 'mallory', type: 'User' } }); // context names navesarussi
  assert.equal(classifyAppCheck(SNYK, { statuses: [bot, stranger, mismatch] }).state, 'absent');
  const realFail = snyk({ id: 9, state: 'failure', updated_at: '2026-11-16T07:00:00Z' });
  assert.equal(classifyAppCheck(SNYK, { statuses: [bot, realFail] }).state, 'failed');
});

test('Snyk: the newest status of the context decides', () => {
  const pending = snyk({ id: 1, state: 'pending', updated_at: '2026-11-16T07:00:00Z' });
  const done = snyk({ id: 2, state: 'success', updated_at: '2026-11-16T07:01:00Z' });
  assert.equal(classifyAppCheck(SNYK, { statuses: [pending, done] }).state, 'ok');
});

test('which scans apply per event', () => {
  assert.deepEqual(appChecksFor('pull_request').map((s) => s.id), ['gitguardian', 'snyk']);
  assert.deepEqual(appChecksFor('pull_request_review').map((s) => s.id), ['gitguardian', 'snyk']);
  assert.deepEqual(appChecksFor('merge_group').map((s) => s.id), ['gitguardian']);
  assert.deepEqual(appChecksFor('push'), []);
  assert.deepEqual(appChecksFor('workflow_dispatch'), []);
});

test('absent scans wait out the grace, then are ignored', () => {
  const specs = appChecksFor('pull_request');
  assert.equal(judgeSnapshot(specs, {}, 0).done, false);
  const after = judgeSnapshot(specs, {}, ABSENT_GRACE_MS);
  assert.equal(after.done, true);
  assert.deepEqual(after.errors, []);
  assert.equal(after.notes.length, 2);
});

test('pending scans wait, then fail with a clear message after the bound', () => {
  const specs = appChecksFor('pull_request');
  const snap = { checkRuns: [gg({ status: 'in_progress', conclusion: null })], statuses: [snyk()] };
  assert.equal(judgeSnapshot(specs, snap, PENDING_WAIT_MS - 1).done, false);
  const late = judgeSnapshot(specs, snap, PENDING_WAIT_MS);
  assert.equal(late.done, true);
  assert.equal(late.errors.length, 1);
  assert.match(late.errors[0], /GitGuardian.*still pending after 8 min/);
});

test('a failure is reported at once, even while another scan is pending', () => {
  const specs = appChecksFor('pull_request');
  const snap = { checkRuns: [gg({ conclusion: 'failure' })], statuses: [snyk({ state: 'pending' })] };
  const v = judgeSnapshot(specs, snap, 0);
  assert.equal(v.done, false); // keeps waiting for Snyk
  assert.match(v.errors[0], /GitGuardian.*concluded failure/);
});

test('appCheckErrors polls until decided (fake clock)', async () => {
  let t = 0;
  const snaps = [
    { checkRuns: [gg({ status: 'queued', conclusion: null })], statuses: [] },
    { checkRuns: [gg()], statuses: [snyk({ state: 'pending' })] },
    { checkRuns: [gg()], statuses: [snyk({ state: 'failure', description: '1 critical' })] },
  ];
  let i = 0;
  const res = await appCheckErrors(
    { EVENT_NAME: 'pull_request', HEAD_SHA: 'abc' },
    { read: async () => snaps[Math.min(i++, snaps.length - 1)], sleep: async (ms) => { t += ms; }, now: () => t },
  );
  assert.equal(i, 3);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /Snyk.*status failure: 1 critical/);
});

test('appCheckErrors: merge group ignores Snyk entirely and passes on GitGuardian neutral', async () => {
  const res = await appCheckErrors(
    { EVENT_NAME: 'merge_group', HEAD_SHA: 'abc' },
    { read: async () => ({ checkRuns: [gg({ conclusion: 'neutral' })], statuses: [] }), sleep: async () => {}, now: () => 0 },
  );
  assert.deepEqual(res.errors, []);
});

test('appCheckErrors: push runs are not judged and read nothing', async () => {
  const res = await appCheckErrors({ EVENT_NAME: 'push', HEAD_SHA: 'abc' }, { read: async () => { throw new Error('read'); } });
  assert.deepEqual(res.errors, []);
});

test('appCheckErrors: a missing HEAD_SHA fails closed', async () => {
  const res = await appCheckErrors({ EVENT_NAME: 'pull_request' }, { read: async () => ({}) });
  assert.match(res.errors[0], /HEAD_SHA/);
});
