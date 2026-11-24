// Run: node --test scripts/maestro-queue-turn.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockReason, earlierEntries, firstBlocker, queueEntries, readEntries } from './maestro-queue-turn.mjs';

const e = (position, oid, number) => ({ position, headCommit: { oid }, pullRequest: { number } });
const job = (name, status, conclusion = null) => ({ name, status, conclusion });
const EMU = 'maestro / maestro · android emulator';
const APK = 'maestro / maestro · build E2E APK';

const sha = (c) => c.repeat(40);
const ref = (n, base, head) => ({ ref: `refs/heads/gh-readonly-queue/dev/pr-${n}-${sha(base)}`, object: { sha: sha(head) } });
// Live shape of 24 Nov 2026: dev tip 8c8144f1 → #2652 → #2661 → #2644 → #2645 → #2658.
const REFS = [ref(2658, '4', '5'), ref(2652, '0', '1'), ref(2645, '3', '4'), ref(2661, '1', '2'), ref(2644, '2', '3'),
  { ref: 'refs/heads/gh-readonly-queue/dev/garbage', object: { sha: sha('9') } }];

test('queueEntries parses gh-readonly-queue refs and ignores anything else', () => {
  const q = queueEntries(REFS);
  assert.equal(q.length, 5);
  assert.deepEqual(q.find((x) => x.pullRequest.number === 2661), { pullRequest: { number: 2661 }, base: sha('1'), headCommit: { oid: sha('2') } });
  assert.deepEqual(queueEntries(undefined), []);
});

test('earlierEntries walks back from our base: the entries ahead of us, head first', () => {
  const q = queueEntries(REFS);
  assert.deepEqual(earlierEntries(q, sha('5'), sha('4')).map((x) => [x.position, x.pullRequest.number]),
    [[1, 2652], [2, 2661], [3, 2644], [4, 2645]]);
  assert.deepEqual(earlierEntries(q, sha('1'), sha('0')), [], 'the head waits for nobody');
  assert.equal(earlierEntries(q, sha('7'), sha('5')), null, 'our group is gone: obsolete');
  const loop = [{ pullRequest: { number: 1 }, base: sha('b'), headCommit: { oid: sha('a') } }, { pullRequest: { number: 2 }, base: sha('a'), headCommit: { oid: sha('b') } }];
  assert.equal(earlierEntries(loop, sha('b'), sha('a')).length, 2, 'a malformed cycle terminates');
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

test('readEntries lists the base branch queue refs and fails on a malformed answer', async () => {
  let path;
  const q = await readEntries(async (p) => { path = p; return REFS; }, 'o/r', 'refs/heads/dev');
  assert.equal(path, '/repos/o/r/git/matching-refs/heads/gh-readonly-queue/dev/');
  assert.equal(q.length, 5);
  await assert.rejects(readEntries(async () => ({ message: 'nope' }), 'o/r', 'dev'), /not return a list/);
});
