// Tests for scripts/ci-base.mjs and its two callers (the ci.yml comparison in
// scripts/ci-gate.mjs and scripts/check-test-integrity.mjs): an owner's approval
// is required only for changes into `main`. Run: node --test scripts/ci-base.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerApprovalRequired, targetBranch } from './ci-base.mjs';
import { ciWorkflowErrors } from './ci-gate.mjs';

const dir = mkdtempSync(join(tmpdir(), 'ci-base-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('targetBranch reads BASE_REF, accepting a full ref', () => {
  assert.equal(targetBranch({ BASE_REF: 'dev' }), 'dev');
  assert.equal(targetBranch({ BASE_REF: 'refs/heads/main' }), 'main');
});

test('targetBranch falls back to the event payload (pull request, then merge group)', () => {
  const payload = join(dir, 'event.json');
  writeFileSync(payload, JSON.stringify({ pull_request: { base: { ref: 'dev' } } }));
  assert.equal(targetBranch({ GITHUB_EVENT_PATH: payload }), 'dev');
  writeFileSync(payload, JSON.stringify({ merge_group: { base_ref: 'refs/heads/main' } }));
  assert.equal(targetBranch({ GITHUB_EVENT_PATH: payload }), 'main');
  writeFileSync(payload, JSON.stringify({ push: {} }));
  assert.equal(targetBranch({ GITHUB_EVENT_PATH: payload }), null);
  assert.equal(targetBranch({ GITHUB_EVENT_PATH: join(dir, 'missing.json') }), null);
  assert.equal(targetBranch({}), null);
});

test('only dev is exempt; main, other and unknown targets need the owner', () => {
  assert.equal(ownerApprovalRequired({ BASE_REF: 'dev' }), false);
  assert.equal(ownerApprovalRequired({ BASE_REF: 'refs/heads/dev' }), false);
  for (const BASE_REF of ['main', 'refs/heads/main', 'release/1', 'develop', 'dev-x', '']) {
    assert.equal(ownerApprovalRequired({ BASE_REF }), true, BASE_REF);
  }
  assert.equal(ownerApprovalRequired({}), true, 'an unknown target fails closed');
});

// ── the callers, against a throwaway repository: a base commit, and a head that
// rewires ci.yml and deletes a test file.
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const commit = (message) => {
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
};
git('init', '-q');
mkdirSync(join(dir, '.github/workflows'), { recursive: true });
writeFileSync(join(dir, '.github/workflows/ci.yml'), 'name: CI\njobs:\n  gate:\n    name: CI gate\n    steps: [a]\n');
writeFileSync(join(dir, 'a.test.mjs'), "import assert from 'node:assert';\nassert.ok(true);\n");
const BASE = commit('base');
writeFileSync(join(dir, '.github/workflows/ci.yml'), 'name: CI\njobs:\n  gate:\n    name: CI gate\n    steps: [b]\n');
rmSync(join(dir, 'a.test.mjs'));
const HEAD = commit('weaken');

const env = (BASE_REF) => ({ EVENT_NAME: 'pull_request', BASE_REF, JUDGE_REF: BASE, BASE_SHA: BASE, HEAD_SHA: HEAD, PR_NUMBER: '1', GITHUB_REPOSITORY: 'o/r' });

test('the ci.yml comparison passes on dev with a warning, and still fails into main', async () => {
  const logs = [];
  const real = console.log;
  console.log = (line) => logs.push(line);
  let onDev;
  try {
    onDev = await ciWorkflowErrors(env('dev'), dir);
  } finally {
    console.log = real;
  }
  assert.deepEqual(onDev, []);
  assert.ok(logs.some((l) => l.startsWith('::warning::') && l.includes('allowed')), 'the finding stays visible');
  // No owners file at the base commit, so no override is possible: red, without any API call.
  const onMain = await ciWorkflowErrors(env('main'), dir);
  assert.ok(onMain.length > 0);
  assert.match(onMain.at(-1), /ci\.yml must keep the base branch's lanes and jobs unless an owner approves/);
});

test('the test-integrity guard passes on dev with a warning, and still fails into main', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'check-test-integrity.mjs');
  const run = (BASE_REF) => spawnSync('node', [script], { cwd: dir, env: { ...process.env, ...env(BASE_REF) }, encoding: 'utf8' });
  const onDev = run('dev');
  assert.equal(onDev.status, 0, onDev.stdout + onDev.stderr);
  assert.match(onDev.stdout, /::warning::Test integrity: .* — allowed: owner approval is required only for changes into main/);
  const onMain = run('main');
  assert.equal(onMain.status, 1);
  assert.match(onMain.stdout, /needs an owner's approval/);
});
