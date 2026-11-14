import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLOT_STEP, decide, findMe } from './kc-dev-slot.mjs';

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
    { id: 2, status: 'in_progress', runner_name: 'r1', steps: [{ name: SLOT_STEP, status: 'queued' }] },
    { id: 3, status: 'in_progress', runner_name: 'r2', steps: [{ name: SLOT_STEP, started_at: '2026-11-15T00:00:00Z' }] },
  ];
  assert.deepEqual(findMe(jobs, 'r1'), { id: 2, stepStartedAt: null });
  assert.deepEqual(findMe(jobs, 'r2'), { id: 3, stepStartedAt: '2026-11-15T00:00:00Z' });
  assert.equal(findMe(jobs, 'r9'), null);
});
