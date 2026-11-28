import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { checkpointDecision, waitForCheckpoint } from './version-checkpoint.mjs';
const state = { head: 'merge', versionCommit: 'version', versionTime: 1000 };
test('eligible even if the merge queue is continuously busy', () => {
  assert.deepEqual(checkpointDecision({ ...state, now: 4600 }), { proceed: true, waitSeconds: 0 });
});
test('no further merge is required to catch up at the deadline', async () => {
  let clock = 4500, reads = 0;
  const proceed = await waitForCheckpoint({ readState: () => { reads++; return state; }, now: () => clock, sleep: async seconds => { clock += seconds; } });
  assert.equal(proceed, true); assert.equal(clock, 4600); assert.equal(reads, 3);
});
test('another merge and its immediate IDs during wait do not extend the checkpoint deadline', async () => {
  let clock = 1100, assigned = false, reads = 0;
  const proceed = await waitForCheckpoint({ readState: () => { reads++; return { ...state, head: assigned ? 'new-merge-with-IDs' : 'merge' }; }, now: () => clock, sleep: async seconds => { assigned = true; clock += seconds; } });
  assert.equal(proceed, true); assert.equal(assigned, true); assert.equal(clock, 4600); assert.ok(reads > 1);
});
test('a VERSION-only tip produces no bump and no waiting loop', async () => {
  assert.equal(await waitForCheckpoint({ readState: () => ({ ...state, head: state.versionCommit }), sleep: () => assert.fail('must not sleep') }), false);
});
test('a newer automatic or explicit checkpoint ends an older waiter', async () => {
  let newer = false;
  assert.equal(await waitForCheckpoint({ readState: () => newer ? { ...state, versionCommit: 'new-checkpoint' } : state, now: () => 1001, sleep: async () => { newer = true; } }), false);
});
test('future-dated checkpoint is rejected rather than waiting beyond the window', () => {
  assert.throws(() => checkpointDecision({ ...state, now: 999 }), /future/);
});
test('workflow makes assignment independent of waiting and mints write token only afterward', () => {
  const wf = parse(readFileSync(new URL('../.github/workflows/bump-version-on-merge.yml', import.meta.url), 'utf8'));
  const assign = wf.jobs.bump, checkpoint = wf.jobs.checkpoint;
  assert.equal(wf.concurrency, undefined);
  assert.notEqual(assign.concurrency.group, checkpoint.concurrency.group);
  assert.equal(assign.concurrency['cancel-in-progress'], false);
  assert.equal(checkpoint.concurrency['cancel-in-progress'], false);
  assert.equal(checkpoint.needs, 'bump');
  assert.ok(checkpoint['timeout-minutes'] >= 70);
  const wait = checkpoint.steps.findIndex(s => s.id === 'eligibility');
  const token = checkpoint.steps.findIndex(s => s.id === 'app');
  assert.ok(wait >= 0 && token > wait);
  assert.equal(wf.on.schedule, undefined);
  assert.equal(JSON.stringify(wf).includes('RELEASE_CHECKPOINT_NOW'), false);
});
