// Unit tests for scripts/check-db-schema-freeze.mjs. Run: node --test scripts/check-db-schema-freeze.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUTOVER_BRANCH, MESSAGE, decide, frozenFiles, prNumberFromQueueRef } from './check-db-schema-freeze.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-db-schema-freeze.mjs');
const base = { freeze: 'true', baseRef: 'dev', files: ['supabase/migrations/0900_x.sql'], branch: 'feat/x', sameRepo: true };

test('frozenFiles matches migrations, baseline and schemas only', () => {
  assert.deepEqual(
    frozenFiles(['supabase/migrations/1.sql', 'supabase/baseline/0001_baseline.sql', 'supabase/schemas/00_foundation/a.sql', 'supabase/functions/a/index.ts', 'supabase/tests/x.sql', 'app/a.ts']),
    ['supabase/migrations/1.sql', 'supabase/baseline/0001_baseline.sql', 'supabase/schemas/00_foundation/a.sql'],
  );
});

test('a frozen change into dev fails with the freeze message', () => {
  const r = decide(base);
  assert.equal(r.ok, false);
  assert.equal(r.reason, MESSAGE);
});

test('the cut-over branch is exempt, a fork with that branch name is not', () => {
  assert.equal(decide({ ...base, branch: CUTOVER_BRANCH }).ok, true);
  assert.equal(decide({ ...base, branch: CUTOVER_BRANCH, sameRepo: false }).ok, false);
});

test('an unknown branch fails', () => {
  assert.equal(decide({ ...base, branch: null }).ok, false);
});

test('freeze off, other base, or no frozen file passes', () => {
  assert.equal(decide({ ...base, freeze: '' }).ok, true);
  assert.equal(decide({ ...base, freeze: 'false' }).ok, true);
  assert.equal(decide({ ...base, freeze: undefined }).ok, true);
  assert.equal(decide({ ...base, baseRef: 'main' }).ok, true);
  assert.equal(decide({ ...base, files: ['supabase/functions/translate/index.ts', 'docs/x.md'] }).ok, true);
});

test('merge-queue ref gives the PR number', () => {
  assert.equal(prNumberFromQueueRef('refs/heads/gh-readonly-queue/dev/pr-2123-3d3c42e5aac5ba805825da76410c181273ba90b1'), 2123);
  assert.equal(prNumberFromQueueRef('gh-readonly-queue/dev/pr-7-abcdef1'), 7);
  assert.equal(prNumberFromQueueRef('refs/heads/feat/pr-7-abcdef1'), null);
  assert.equal(prNumberFromQueueRef(undefined), null);
});

function repoWith(changed) {
  const dir = mkdtempSync(join(tmpdir(), 'freeze-'));
  const run = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
  run('init', '-q');
  writeFileSync(join(dir, 'README.md'), 'a');
  run('add', '-A');
  run('commit', '-q', '-m', 'base');
  const baseSha = run('rev-parse', 'HEAD');
  for (const f of changed) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    writeFileSync(join(dir, f), 'x');
  }
  run('add', '-A');
  run('commit', '-q', '-m', 'change');
  return { dir, baseSha, headSha: run('rev-parse', 'HEAD') };
}

function runCli(changed, env) {
  const { dir, baseSha, headSha } = repoWith(changed);
  try {
    const out = execFileSync('node', [SCRIPT], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, EVENT_NAME: 'pull_request', BASE_REF: 'dev', BASE_SHA: baseSha, HEAD_SHA: headSha, REPO: 'o/r', HEAD_REPO: 'o/r', HEAD_REF: 'feat/x', FREEZE: 'true', ...env },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('CLI: blocks a migration on a normal branch and prints the message', () => {
  const r = runCli(['supabase/migrations/0900_x.sql'], {});
  assert.equal(r.code, 1);
  assert.match(r.out, /DB schema freeze until the production baseline cut-over merges/);
  assert.match(r.out, /supabase\/migrations\/0900_x\.sql/);
});

test('CLI: passes on the cut-over branch, with the freeze off, and without frozen files', () => {
  assert.equal(runCli(['supabase/migrations/0900_x.sql'], { HEAD_REF: CUTOVER_BRANCH }).code, 0);
  assert.equal(runCli(['supabase/migrations/0900_x.sql'], { FREEZE: '' }).code, 0);
  assert.equal(runCli(['docs/a.md', 'supabase/functions/a/index.ts'], {}).code, 0);
});

test('CLI: a merge-queue run with an unreadable PR number fails closed', () => {
  const r = runCli(['supabase/baseline/0001_baseline.sql'], { EVENT_NAME: 'merge_group', HEAD_REF: 'refs/heads/weird' });
  assert.equal(r.code, 1);
  assert.match(r.out, /failing closed/);
});
