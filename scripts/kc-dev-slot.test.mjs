import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ApiError, INHERIT_MAX_LINKS, SLOT_STEP, backoffMs, decide, findMe, inheritedStart, retryAfterMs, slotWorkflows } from './kc-dev-slot.mjs';

const me = { id: 100, stepStartedAt: '2026-11-15T00:10:00Z' };
const job = (id, stepStatus, startedAt, status = 'in_progress') => ({
  id,
  status,
  steps: [{ name: 'Build', status: 'completed', started_at: '2026-11-15T00:00:00Z' }, { name: SLOT_STEP, status: stepStatus, started_at: startedAt }],
});

test('goes when no other job holds or waits', () => {
  assert.deepEqual(decide(me, [], 2), { go: true, holders: 0, ahead: 0 });
});

test('counts jobs past the slot step as holders', () => {
  const r = decide(me, [job(1, 'completed', '2026-11-15T00:01:00Z'), job(2, 'completed', '2026-11-15T00:02:00Z')], 2);
  assert.deepEqual(r, { go: false, holders: 2, ahead: 0 });
});

test('waiters that started the slot step earlier are ahead (FIFO), later ones are not', () => {
  const jobs = [job(1, 'completed', '2026-11-15T00:01:00Z'), job(2, 'in_progress', '2026-11-15T00:05:00Z'), job(3, 'in_progress', '2026-11-15T00:20:00Z')];
  assert.deepEqual(decide(me, jobs, 2), { go: false, holders: 1, ahead: 1 });
  assert.deepEqual(decide(me, jobs, 3), { go: true, holders: 1, ahead: 1 });
});

test('a tie on the start time is broken by job id', () => {
  assert.equal(decide(me, [job(99, 'in_progress', me.stepStartedAt)], 1).go, false);
  assert.equal(decide(me, [job(101, 'in_progress', me.stepStartedAt)], 1).go, true);
});

test('ignores itself, finished jobs and jobs without the slot step', () => {
  const jobs = [
    job(100, 'completed', '2026-11-15T00:01:00Z'),
    job(5, 'completed', '2026-11-15T00:01:00Z', 'completed'),
    { id: 6, status: 'in_progress', steps: [{ name: 'Lint', status: 'in_progress', started_at: '2026-11-15T00:00:00Z' }] },
  ];
  assert.deepEqual(decide(me, jobs, 1), { go: true, holders: 0, ahead: 0 });
});

test('findMe matches the in-progress job on this runner and tolerates an unrecorded step start', () => {
  const jobs = [
    { id: 1, status: 'completed', runner_name: 'r1', steps: [] },
    { id: 2, name: 'm', status: 'in_progress', runner_name: 'r1', steps: [{ name: SLOT_STEP, status: 'queued' }] },
    { id: 3, name: 'e', status: 'in_progress', runner_name: 'r2', steps: [{ name: SLOT_STEP, started_at: '2026-11-15T00:00:00Z' }] },
  ];
  assert.deepEqual(findMe(jobs, 'r1'), { id: 2, name: 'm', stepStartedAt: null });
  assert.deepEqual(findMe(jobs, 'r2'), { id: 3, name: 'e', stepStartedAt: '2026-11-15T00:00:00Z' });
  assert.equal(findMe(jobs, 'r9'), null);
});

const headers = (h) => new Headers(h);

test('retryAfterMs reads Retry-After, then an exhausted X-RateLimit-Reset, else null', () => {
  assert.equal(retryAfterMs(headers({ 'retry-after': '30' })), 30_000);
  assert.equal(retryAfterMs(headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1000' }), 900_000), 100_000);
  assert.equal(retryAfterMs(headers({ 'x-ratelimit-remaining': '5', 'x-ratelimit-reset': '1000' }), 900_000), null);
  assert.equal(retryAfterMs(headers({})), null);
});

test('an API error waits (what the API asked, at least the poll interval, at most the cap), never a free pass', () => {
  assert.equal(backoffMs(new ApiError(403, '/x', null), 60_000, 600_000), 60_000);
  assert.equal(backoffMs(new ApiError(403, '/x', 120_000), 60_000, 600_000), 121_000);
  assert.equal(backoffMs(new ApiError(429, '/x', 3_600_000), 60_000, 600_000), 600_000);
  assert.equal(backoffMs(new Error('fetch failed'), 60_000, 600_000), 60_000);
});

test('slotWorkflows finds the workflows that run the script and, transitively, their callers', () => {
  const files = {
    'lane.yml': 'run: node scripts/kc-dev-slot.mjs',
    'ci.yml': 'jobs:\n  a:\n    uses: ./.github/workflows/lane.yml',
    'nightly.yml': 'uses: ./.github/workflows/ci.yml',
    'deploy.yml': 'uses: ./.github/workflows/deploy-web.yml',
    'deploy-web.yml': 'run: echo',
  };
  assert.deepEqual([...slotWorkflows(files)].sort(), ['.github/workflows/ci.yml', '.github/workflows/lane.yml', '.github/workflows/nightly.yml']);
});

test('in this repository the slot workflows include CI and every nightly/health run that tests against kc-dev', () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  const files = Object.fromEntries(readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]));
  const got = slotWorkflows(files);
  for (const f of ['ci.yml', 'ci-maestro-android.yml', 'ci-release.yml', 'e2e-nightly-dev.yml', 'maestro-dev-health.yml', 'mobile-nightly.yml']) {
    assert.ok(got.has(`.github/workflows/${f}`), f);
  }
  assert.equal(got.has('.github/workflows/deploy.yml'), false);
});

test('a waiter that inherited an earlier place (queuedAt) is ahead of a later starter', () => {
  // #1619: PR B was superseded at 00:30 after queueing at 00:02; its new run starts the step at 00:40.
  const replaced = { ...job(7, 'in_progress', '2026-11-15T00:40:00Z'), queuedAt: '2026-11-15T00:02:00Z' };
  const holder = job(1, 'completed', '2026-11-15T00:00:00Z');
  assert.deepEqual(decide(me, [holder, replaced], 2), { go: false, holders: 1, ahead: 1 });
  assert.equal(decide({ ...me, queuedAt: '2026-11-15T00:01:00Z' }, [holder, replaced], 2).go, true);
});

test('without queuedAt the queue is ordered by the slot step start, as before', () => {
  assert.equal(decide({ ...me, queuedAt: undefined }, [job(2, 'in_progress', '2026-11-15T00:05:00Z')], 1).go, false);
});

const created = '2026-11-21T17:40:00Z';
const p = (conclusion, stepConclusion, startedAt) => ({ conclusion, step: stepConclusion === null ? null : { conclusion: stepConclusion, started_at: startedAt } });

test('inherits the start of a superseded run that was still waiting', () => {
  assert.equal(inheritedStart(created, [p('cancelled', 'cancelled', '2026-11-21T17:05:00Z')]), '2026-11-21T17:05:00Z');
});

test('walks a chain of superseded runs and keeps the earliest place', () => {
  const chain = [p('cancelled', 'cancelled', '2026-11-21T17:30:00Z'), p('cancelled', null), p('cancelled', 'cancelled', '2026-11-21T16:50:00Z')];
  assert.equal(inheritedStart(created, chain), '2026-11-21T16:50:00Z');
});

test('does not inherit from a run that got its slot, or finished any other way', () => {
  assert.equal(inheritedStart(created, [p('cancelled', 'success', '2026-11-21T17:00:00Z')]), null);
  assert.equal(inheritedStart(created, [p('failure', 'success', '2026-11-21T17:00:00Z')]), null);
  assert.equal(inheritedStart(created, [p('success', 'success', '2026-11-21T17:00:00Z'), p('cancelled', 'cancelled', '2026-11-21T16:00:00Z')]), null);
  assert.equal(inheritedStart(created, [p('cancelled', 'cancelled', '2026-11-21T17:20:00Z'), p('cancelled', 'success', '2026-11-21T16:00:00Z'), p('cancelled', 'cancelled', '2026-11-21T15:00:00Z')]), '2026-11-21T17:20:00Z');
});

test('a run cancelled before it queued passes nothing on', () => {
  assert.equal(inheritedStart(created, [p('cancelled', null)]), null);
  assert.equal(inheritedStart(created, [{ conclusion: 'cancelled', step: { conclusion: 'skipped', started_at: null } }]), null);
  // GitHub records a start time even on a skipped step (cancelled before it ran): not a place.
  assert.equal(inheritedStart(created, [p('cancelled', 'skipped', '2026-11-21T17:38:53Z')]), null);
  // ... and the walk goes on past it (#2578 on 21 Nov: skipped re-run, then a 62-min wait cancelled).
  assert.equal(inheritedStart(created, [p('cancelled', 'skipped', '2026-11-21T17:38:53Z'), p('cancelled', 'cancelled', '2026-11-21T16:35:21Z')]), '2026-11-21T16:35:21Z');
});

test('the inherited place is bounded by the lookback and the number of links', () => {
  assert.equal(inheritedStart(created, [p('cancelled', 'cancelled', '2026-11-21T11:00:00Z')]), null);
  assert.equal(inheritedStart(created, [p('cancelled', 'cancelled', '2026-11-21T12:00:00Z')]), '2026-11-21T12:00:00Z');
  const long = Array.from({ length: INHERIT_MAX_LINKS + 1 }, (_, i) => p('cancelled', 'cancelled', `2026-11-21T17:${String(45 - i * 5).padStart(2, '0')}:00Z`));
  assert.equal(inheritedStart(created, long), `2026-11-21T17:${String(45 - (INHERIT_MAX_LINKS - 1) * 5).padStart(2, '0')}:00Z`);
  assert.equal(inheritedStart(created, []), null);
});

test('findMe reports the job name used to find its predecessors', () => {
  const jobs = [{ id: 3, name: 'Maestro / maestro', status: 'in_progress', runner_name: 'r1', steps: [{ name: SLOT_STEP, started_at: '2026-11-21T17:00:00Z' }] }];
  assert.deepEqual(findMe(jobs, 'r1'), { id: 3, name: 'Maestro / maestro', stepStartedAt: '2026-11-21T17:00:00Z' });
});
