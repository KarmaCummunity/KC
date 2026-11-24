// Run: node --test scripts/maestro-queue-turn.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockReason, earlierEntries, firstBlocker, readEntries } from './maestro-queue-turn.mjs';

const e = (position, oid, number) => ({ position, headCommit: { oid }, pullRequest: { number } });
const job = (name, status, conclusion = null) => ({ name, status, conclusion });
const EMU = 'maestro / maestro · android emulator';
const APK = 'maestro / maestro · build E2E APK';

test('earlierEntries: the entries ahead of ours, by position; null when we are not queued', () => {
  const q = [e(3, 'c', 3), e(1, 'a', 1), e(2, 'b', 2)];
  assert.deepEqual(earlierEntries(q, 'c').map((x) => x.position), [1, 2]);
  assert.deepEqual(earlierEntries(q, 'a'), []);
  assert.equal(earlierEntries(q, 'zzz'), null);
  assert.equal(earlierEntries(undefined, 'a'), null);
});

test('blockReason: an earlier entry blocks while its Maestro is unfinished', () => {
  const live = { status: 'in_progress' };
  assert.equal(blockReason(live, [job(EMU, 'in_progress')]), 'emulator in_progress');
  assert.equal(blockReason(live, [job(EMU, 'pending')]), 'emulator pending');
  assert.equal(blockReason(live, [job(APK, 'in_progress')]), 'Maestro planned, APK building');
  assert.equal(blockReason(live, [job(APK, 'completed', 'success')]), 'Maestro planned, emulator not started');
  assert.equal(blockReason(live, [job('detect changes', 'in_progress')]), 'lanes not planned yet');
});

test('blockReason: nothing to wait for', () => {
  const live = { status: 'in_progress' };
  assert.equal(blockReason(null, []), null);
  assert.equal(blockReason({ status: 'completed' }, [job(EMU, 'pending')]), null);
  assert.equal(blockReason(live, [job(EMU, 'completed', 'failure')]), null);
  assert.equal(blockReason(live, [job(APK, 'completed', 'failure')]), null, 'a failed build skips the emulator');
  assert.equal(blockReason(live, [job('detect changes', 'completed', 'success'), job('backend / x', 'in_progress')]), null, 'no Maestro planned');
});

test('firstBlocker checks from the head down and stops at the first blocker', async () => {
  const calls = [];
  const runs = { a: { id: 1, status: 'completed' }, b: { id: 2, status: 'in_progress' }, c: { id: 3, status: 'in_progress' } };
  const jobs = { 2: [job(EMU, 'in_progress')], 3: [job(EMU, 'pending')] };
  const gh = async (path) => {
    calls.push(path);
    const sha = /head_sha=(\w+)/.exec(path)?.[1];
    if (sha) return { workflow_runs: runs[sha] ? [runs[sha]] : [] };
    return { jobs: jobs[/runs\/(\d+)\/jobs/.exec(path)[1]] };
  };
  const b = await firstBlocker(gh, 'o/r', [e(1, 'a', 11), e(2, 'b', 12), e(3, 'c', 13)]);
  assert.equal(b.entry.pullRequest.number, 12);
  assert.equal(b.reason, 'emulator in_progress');
  assert.ok(!calls.some((p) => p.includes('head_sha=c')), 'stopped at the first blocker');
  assert.ok(!calls.some((p) => p.includes('/runs/1/jobs')), 'completed runs need no job read');
  assert.equal(await firstBlocker(gh, 'o/r', [e(1, 'a', 11), e(4, 'x', 14)]), null, 'no run found does not block');
});

test('readEntries reads the base branch queue and fails on a malformed answer', async () => {
  let vars;
  const nodes = [e(1, 'a', 1)];
  assert.deepEqual(await readEntries(async (_q, v) => { vars = v; return { repository: { mergeQueue: { entries: { nodes } } } }; }, 'o/r', 'refs/heads/dev'), nodes);
  assert.deepEqual(vars, { o: 'o', n: 'r', b: 'dev' });
  await assert.rejects(readEntries(async () => ({ repository: { mergeQueue: null } }), 'o/r', 'dev'), /no mergeQueue/);
});
