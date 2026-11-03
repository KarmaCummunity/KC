// Unit tests for scripts/ci-workflow-diff.mjs. Run: node --test scripts/ci-workflow-diff.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CI_WORKFLOW, compareWorkflows, workflowDrift } from './ci-workflow-diff.mjs';

const BASE = `name: CI
on:
  pull_request:
jobs:
  changes:
    runs-on: ubuntu-latest
  frontend:
    needs: changes
    uses: ./.github/workflows/ci-frontend.yml
  gate:
    name: CI gate
    needs: [changes, frontend]
    if: always()
    steps:
      - run: node judge.mjs
`;

test('identical workflows have no drift', () => {
  assert.deepEqual(compareWorkflows(BASE, BASE), []);
});

test('comment and blank-line edits are not drift', () => {
  const head = BASE.replace('jobs:\n', '# explain the jobs\n\njobs:\n').replace('  frontend:\n', '  # lane\n  frontend:\n');
  assert.deepEqual(compareWorkflows(BASE, head), []);
});

test('a rewritten gate step is drift', () => {
  assert.deepEqual(compareWorkflows(BASE, BASE.replace('node judge.mjs', 'true')), [`${CI_WORKFLOW}: job "gate" changed`]);
});

test('a dropped lane is reported as removed and the gate as changed', () => {
  const head = BASE.replace(/ {2}frontend:\n(?: {4}.*\n)+/, '').replace('[changes, frontend]', '[changes]');
  assert.deepEqual(compareWorkflows(BASE, head), [`${CI_WORKFLOW}: job "gate" changed`, `${CI_WORKFLOW}: job "frontend" removed`]);
});

test('an added job and a trigger change are reported', () => {
  const head = BASE.replace('  pull_request:\n', '  pull_request:\n  push:\n') + '  extra:\n    runs-on: ubuntu-latest\n';
  assert.deepEqual(compareWorkflows(BASE, head), [
    `${CI_WORKFLOW}: triggers, concurrency, permissions or env changed`,
    `${CI_WORKFLOW}: job "extra" added`,
  ]);
});

test('a workflow without a jobs block is drift', () => {
  assert.equal(compareWorkflows(BASE, 'name: CI\n').length, 1);
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commit(dir, files, message) {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

test('workflowDrift compares only when the PR itself touches ci.yml', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-workflow-diff-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 'ci@example.com');
    git(dir, 'config', 'user.name', 'ci');
    const base = commit(dir, { [CI_WORKFLOW]: BASE }, 'base');
    const appOnly = commit(dir, { 'app/a.ts': 'export {};\n' }, 'app');
    assert.deepEqual(workflowDrift({ judgeRef: base, runningRef: appOnly, baseSha: base, headSha: appOnly, cwd: dir }), []);
    const rewired = commit(dir, { [CI_WORKFLOW]: BASE.replace('node judge.mjs', 'true') }, 'rewire');
    assert.deepEqual(workflowDrift({ judgeRef: base, runningRef: rewired, baseSha: base, headSha: rewired, cwd: dir }), [
      `${CI_WORKFLOW}: job "gate" changed`,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workflowDrift throws when git cannot resolve the commits (caller fails closed)', () => {
  assert.throws(() => workflowDrift({ judgeRef: 'nope', runningRef: 'nope', baseSha: 'nope', headSha: 'nope' }));
});
