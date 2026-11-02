// Unit tests for scripts/ci-queue.mjs. Run: node --test scripts/ci-queue.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identifyQueuedPr, parseQueueRef, readQueueHeadRef } from './ci-queue.mjs';

// A throwaway repository shaped like a merge queue: `base`, then two stacked
// squash commits, each subject ending in its PR number.
const dir = mkdtempSync(join(tmpdir(), 'ci-queue-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
function commit(subject) {
  writeFileSync(join(dir, 'f.txt'), `${subject}\n`);
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', subject);
  return git('rev-parse', 'HEAD');
}
git('init', '-q');
const base = commit('base');
const first = commit('feat: first (#11)');
const second = commit('feat: second (#12)');
const queueRef = (number, parent) => `refs/heads/gh-readonly-queue/dev/pr-${number}-${parent}`;

test('parseQueueRef reads the PR number, base branch and parent sha', () => {
  assert.deepEqual(parseQueueRef(queueRef(12, first)), { baseBranch: 'dev', number: 12, parentSha: first });
  assert.equal(parseQueueRef('refs/heads/gh-readonly-queue/release/x/pr-5-' + base)?.baseBranch, 'release/x');
});

test('parseQueueRef rejects anything that is not a queue branch', () => {
  for (const ref of [null, undefined, '', 'refs/heads/dev', `refs/heads/pr-12-${first}`, `refs/heads/gh-readonly-queue/dev/pr-12-${first.slice(0, 7)}`, `refs/heads/gh-readonly-queue/dev/pr-x-${first}`, `refs/pull/12/merge`]) {
    assert.equal(parseQueueRef(ref), null, String(ref));
  }
});

test('a stacked entry is identified from its own single commit', () => {
  assert.deepEqual(identifyQueuedPr({ headRef: queueRef(12, first), baseSha: first, headSha: second }, dir), { number: 12, baseBranch: 'dev' });
  assert.deepEqual(identifyQueuedPr({ headRef: queueRef(11, base), baseSha: base, headSha: first }, dir), { number: 11, baseBranch: 'dev' });
});

test('a head ref that is not a queue branch yields no PR', () => {
  const r = identifyQueuedPr({ headRef: 'refs/heads/dev', baseSha: first, headSha: second }, dir);
  assert.match(r.why, /not a merge-queue branch/);
});

test('a queue branch not built on the base commit yields no PR', () => {
  const r = identifyQueuedPr({ headRef: queueRef(12, base), baseSha: first, headSha: second }, dir);
  assert.match(r.why, /not built directly on the run's base commit/);
});

test('a group that adds more than one commit yields no PR', () => {
  const r = identifyQueuedPr({ headRef: queueRef(12, base), baseSha: base, headSha: second }, dir);
  assert.match(r.why, /exactly one commit.*found 2/);
});

test('a group that adds no commit yields no PR', () => {
  const r = identifyQueuedPr({ headRef: queueRef(12, second), baseSha: second, headSha: second }, dir);
  assert.match(r.why, /exactly one commit.*found 0/);
});

test('a commit that names another PR than its branch yields no PR', () => {
  const r = identifyQueuedPr({ headRef: queueRef(99, first), baseSha: first, headSha: second }, dir);
  assert.match(r.why, /does not carry the \(#99\)/);
});

test('a commit subject without a PR number yields no PR', () => {
  const plain = commit('chore: no number');
  const r = identifyQueuedPr({ headRef: queueRef(13, second), baseSha: second, headSha: plain }, dir);
  assert.match(r.why, /does not carry the \(#13\)/);
});

test('readQueueHeadRef prefers HEAD_REF, then the event payload, else null', () => {
  assert.equal(readQueueHeadRef({ HEAD_REF: 'x', GITHUB_EVENT_PATH: '/nonexistent' }), 'x');
  const payload = join(dir, 'event.json');
  writeFileSync(payload, JSON.stringify({ merge_group: { head_ref: queueRef(12, first) } }));
  assert.equal(readQueueHeadRef({ GITHUB_EVENT_PATH: payload }), queueRef(12, first));
  writeFileSync(payload, JSON.stringify({ pull_request: {} }));
  assert.equal(readQueueHeadRef({ GITHUB_EVENT_PATH: payload }), null);
  assert.equal(readQueueHeadRef({ GITHUB_EVENT_PATH: '/nonexistent' }), null);
  assert.equal(readQueueHeadRef({}), null);
});
