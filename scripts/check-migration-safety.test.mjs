import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkMigrationSafety,
  checkReleaseMigrations,
  justifiedFiles,
  scanCompatibility,
  scanMigrationSql,
} from './check-migration-safety.mjs';

test('passes benign migration SQL', () => {
  const errors = scanMigrationSql(
    'ALTER TABLE posts ADD COLUMN IF NOT EXISTS foo text;\n',
    '0001.sql'
  );
  assert.deepEqual(errors, []);
});

test('flags DROP TABLE', () => {
  const errors = scanMigrationSql('DROP TABLE legacy_foo;\n', '0002.sql');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /DROP TABLE/);
});

test('does not flag ALTER PUBLICATION ... DROP TABLE (non-destructive)', () => {
  const errors = scanMigrationSql(
    "execute 'alter publication supabase_realtime drop table public.messages';\n",
    '0004.sql'
  );
  assert.deepEqual(errors, []);
});

test('still flags a real DROP TABLE next to a publication change', () => {
  const errors = scanMigrationSql(
    'ALTER PUBLICATION supabase_realtime DROP TABLE a; DROP TABLE b;\n',
    '0005.sql'
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /DROP TABLE/);
});

test('does not flag dropping a pg_temp table', () => {
  const errors = scanMigrationSql('  drop table if exists pg_temp._find_match_ranked;\n', '0006.sql');
  assert.deepEqual(errors, []);
});

test('allows override marker on the same line', () => {
  const errors = scanMigrationSql(
    'DROP TABLE legacy_foo; -- migration-safety: allow phased removal\n',
    '0003.sql'
  );
  assert.deepEqual(errors, []);
});

test('checkMigrationSafety scans directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-safe-'));
  try {
    writeFileSync(join(dir, '0001_ok.sql'), 'SELECT 1;');
    writeFileSync(join(dir, '0002_bad.sql'), 'TRUNCATE users;');
    const result = checkMigrationSafety(dir);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /TRUNCATE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Release (dev → main) mode ────────────────────────────────────────────

const MARKED = { name: '0450_drop_legacy.sql', content: 'DROP TABLE legacy_foo; -- migration-safety: allow phased removal\n' };

test('release mode rejects an allow marker without a PR-body justification', () => {
  const errors = checkReleaseMigrations([MARKED], '## Summary\nRelease.\n');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /0450_drop_legacy\.sql:1: DROP TABLE .* add `Migration safety: 0450_drop_legacy\.sql — <reason>`/);
});

test('release mode accepts a marked line whose file is justified in the PR body', () => {
  const body = 'Notes\nMigration safety: 0450_drop_legacy.sql — table unused since 0300, data archived\n';
  assert.deepEqual(checkReleaseMigrations([MARKED], body), []);
});

test('a justification never excuses an unmarked destructive line', () => {
  const file = { name: '0451_x.sql', content: 'TRUNCATE users;\n' };
  const body = 'Migration safety: 0451_x.sql — emptying a cache table on purpose\n';
  assert.equal(checkReleaseMigrations([file], body).length, 1);
});

test('justifiedFiles needs a file name and a real reason', () => {
  const body = ['Migration safety: 0450_a.sql — ok', 'migration safety: 0451_b.sql: rebuilt from 0449 snapshot', 'Migration safety: — no file'].join('\n');
  assert.deepEqual([...justifiedFiles(body)], ['0451_b.sql']);
});

test('release mode flags every change that can break the previous release', () => {
  const sql = [
    'alter table posts rename column body to text;',
    'alter table posts alter column n type bigint;',
    'alter table posts alter column n set data type bigint;',
    'alter table posts alter column city set not null;',
    'drop function if exists public.f(int);',
    'drop policy if exists p on posts;',
    'alter policy p on posts using (true);',
    'alter table posts disable row level security;',
    '-- drop policy in a comment does not count',
    'create policy p on posts using (true);',
  ].join('\n');
  const hits = scanCompatibility(sql, '0460_x.sql');
  assert.deepEqual(hits.map((h) => h.match(/rule ([a-z-]+)/)[1]), [
    'rename', 'alter-column-type', 'alter-column-type', 'set-not-null', 'drop-function', 'drop-policy', 'alter-policy', 'disable-rls',
  ]);
  const file = { name: '0460_x.sql', content: sql };
  assert.equal(checkReleaseMigrations([file], '').length, 8);
  assert.deepEqual(checkReleaseMigrations([file], 'Migration safety: 0460_x.sql — new column shipped in v1.5.0, code switched in v1.5.3\n'), []);
});

test('an allow marker alone does not excuse a compatibility-breaking line on main', () => {
  const file = { name: '0461_y.sql', content: 'drop function f(); -- migration-safety: allow\n' };
  assert.match(checkReleaseMigrations([file], '')[0], /DROP FUNCTION .* add `Migration safety: 0461_y\.sql/);
});
