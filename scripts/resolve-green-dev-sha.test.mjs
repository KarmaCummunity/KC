// Unit tests for scripts/resolve-green-dev-sha.mjs. Run: node --test scripts/resolve-green-dev-sha.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  branchFromPushRuns,
  isCommitSha,
  parseLookback,
  pickGreenSha,
  resolveNewestGreenDevSha,
} from './resolve-green-dev-sha.mjs';

test('picks the newest commit that has a green CI push run, not the tip', () => {
  assert.equal(pickGreenSha(['tip', 'mid', 'old'], ['old', 'mid']), 'mid');
});

test('returns null when no scanned commit is green', () => {
  assert.equal(pickGreenSha(['a', 'b'], ['z']), null);
  assert.equal(pickGreenSha([], []), null);
});

test('parseLookback defaults to 30 and accepts 1..100', () => {
  assert.equal(parseLookback(undefined), 30);
  assert.equal(parseLookback('1'), 1);
  assert.equal(parseLookback('100'), 100);
});

test('parseLookback refuses values one API page cannot hold', () => {
  assert.throws(() => parseLookback('101'), /1 to 100/);
  assert.throws(() => parseLookback('0'), /1 to 100/);
});

test('branchFromPushRuns prefers main over dev', () => {
  assert.equal(
    branchFromPushRuns([
      { head_branch: 'dev' },
      { head_branch: 'main' },
    ]),
    'main',
  );
  assert.equal(branchFromPushRuns([{ head_branch: 'dev' }]), 'dev');
  assert.equal(branchFromPushRuns([{ head_branch: 'feat/x' }]), null);
});

test('isCommitSha accepts 40-char hex only', () => {
  assert.equal(isCommitSha('a'.repeat(40)), true);
  assert.equal(isCommitSha('abc'), false);
  assert.equal(isCommitSha('g'.repeat(40)), false);
});

test('resolveNewestGreenDevSha walks commits newest-first', async () => {
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    if (path.includes('/commits?')) {
      return [{ sha: 'tip' }, { sha: 'green' }, { sha: 'old' }];
    }
    return { workflow_runs: [{ head_sha: 'green' }, { head_sha: 'old' }] };
  };
  const sha = await resolveNewestGreenDevSha(api, { repo: 'o/r', branch: 'dev', lookback: 30 });
  assert.equal(sha, 'green');
  assert.ok(calls.some((p) => p.includes('branch=dev')));
});
