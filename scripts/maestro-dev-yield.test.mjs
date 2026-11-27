// Run: node --test scripts/maestro-dev-yield.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingEmulatorJobs, readYieldInputs, yieldReason } from './maestro-dev-yield.mjs';

const push = { event: 'push', ref: 'refs/heads/dev', sha: 'a'.repeat(40), devSha: 'a'.repeat(40), mgEmulatorJobs: [] };

test('a dev-push run on the current dev head with no merge group waiting keeps its turn', () => {
  assert.equal(yieldReason(push), null);
});

test('a dev-push run yields when dev moved on', () => {
  assert.match(yieldReason({ ...push, devSha: 'b'.repeat(40) }), /dev moved on to bbbbbbbb/);
});

test('a dev-push run yields while a merge-group emulator job waits', () => {
  const r = yieldReason({ ...push, mgEmulatorJobs: [{ id: 7, html_url: 'https://x/job/7' }] });
  assert.match(r, /merge group is waiting/);
  assert.match(r, /job\/7/);
});

test('merge groups, PRs, manual runs and other branches never yield', () => {
  const waiting = { ...push, devSha: 'b'.repeat(40), mgEmulatorJobs: [{ id: 1 }] };
  for (const event of ['merge_group', 'pull_request', 'workflow_dispatch', 'schedule']) {
    assert.equal(yieldReason({ ...waiting, event }), null, event);
  }
  assert.equal(yieldReason({ ...waiting, ref: 'refs/heads/main' }), null);
});

test('an unknown dev head never counts as "moved"', () => {
  assert.equal(yieldReason({ ...push, devSha: null }), null);
});

test('pendingEmulatorJobs keeps only unfinished emulator jobs', () => {
  const jobs = [
    [{ name: 'maestro / maestro · android emulator', status: 'queued' }, { name: 'maestro / maestro · build E2E APK', status: 'in_progress' }],
    [{ name: 'maestro / maestro · android emulator', status: 'completed' }, { name: 'CI gate', status: 'queued' }],
    [{ name: 'maestro / maestro · android emulator', status: 'waiting' }],
  ];
  assert.deepEqual(pendingEmulatorJobs(jobs).map((j) => j.status), ['queued', 'waiting']);
});

test('readYieldInputs reads dev\'s head and the unfinished merge-group runs\' jobs only', async () => {
  const calls = [];
  const gh = async (path) => {
    calls.push(path);
    if (path.endsWith('/git/ref/heads/dev')) return { object: { sha: 'c'.repeat(40) } };
    if (path.includes('/workflows/ci.yml/runs')) return { workflow_runs: [{ id: 1, status: 'in_progress' }, { id: 2, status: 'completed' }] };
    if (path.includes('/runs/1/jobs')) return { jobs: [{ name: 'maestro / maestro · android emulator', status: 'pending' }] };
    throw new Error(`unexpected ${path}`);
  };
  const r = await readYieldInputs(gh, 'o/r');
  assert.equal(r.devSha, 'c'.repeat(40));
  assert.equal(r.mgEmulatorJobs.length, 1);
  assert.ok(calls.some((p) => p.includes('event=merge_group')));
  assert.ok(!calls.some((p) => p.includes('/runs/2/jobs')));
});
