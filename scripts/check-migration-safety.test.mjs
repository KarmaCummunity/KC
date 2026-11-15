import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkMigrationSafety,
  checkReleaseMigrations,
  isInitialSchema,
  isScannedMigrationPath,
  justifiedFiles,
  permanentTablesCreatedIn,
  scanCompatibility,
  tempTablesCreatedIn,
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

// ── Temp tables created in the same file (demo seed functions, 0654/0657/0676/0678) ──

const TEMP_BODY = [
  'create or replace function public.seed() returns void language plpgsql as $$',
  'begin',
  '  drop table if exists s_users, s_city; -- leftovers from a previous step',
  '  create temp table s_users on commit drop as select 1 as n;',
  '  create temporary table if not exists s_city(n text);',
  '  DROP TABLE s_city;',
  'end $$;',
].join('\n');

test('collects the temp and the persisted tables a file creates', () => {
  assert.deepEqual([...tempTablesCreatedIn(TEMP_BODY)].sort(), ['s_city', 's_users']);
  assert.deepEqual([...permanentTablesCreatedIn('create table if not exists public.keep(id int);\ncreate unlogged table "Other"(x int);')].sort(), ['keep', 'other']);
  assert.deepEqual([...permanentTablesCreatedIn(TEMP_BODY)], []);
});

test('does not flag dropping temp tables the same file creates, even in release mode', () => {
  assert.deepEqual(scanMigrationSql(TEMP_BODY, '0900.sql'), []);
  assert.deepEqual(scanMigrationSql(TEMP_BODY, '0900.sql', { honorAllow: false }), []);
});

test('still flags a drop list that names one table the file does not create as temp', () => {
  const sql = 'create temp table s_users(n int);\ndrop table if exists s_users, users;\n';
  const errors = scanMigrationSql(sql, '0901.sql');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /0901\.sql:2: DROP TABLE/);
});

test('still flags a temp-named drop when a persisted table of that name exists', () => {
  const sql = 'create temp table s_users(n int);\ndrop table if exists s_users;\n';
  assert.equal(scanMigrationSql(sql, '0902.sql', { permanentTables: new Set(['s_users']) }).length, 1);
  const sameFile = 'create table public.s_users(n int);\ncreate temp table s_users(n int);\ndrop table s_users;\n';
  assert.equal(scanMigrationSql(sameFile, '0903.sql').length, 1);
});

test('still flags a schema-qualified drop of a name also created as temp', () => {
  const sql = 'create temp table s_users(n int);\ndrop table public.s_users;\n';
  assert.equal(scanMigrationSql(sql, '0904.sql').length, 1);
});

test('release mode needs no justification for a file whose only finding was a temp-table drop', () => {
  assert.deepEqual(checkReleaseMigrations([{ name: '0905.sql', content: TEMP_BODY }], ''), []);
});

// ── One-word string literals are data, not SQL ──

test('does not read a one-word string literal as a RENAME', () => {
  assert.deepEqual(scanCompatibility("  elsif p_action = 'rename' then\n", '0906.sql'), []);
});

test('still flags RENAME in real DDL and in multi-word dynamic SQL', () => {
  assert.equal(scanCompatibility('alter table a rename column b to c;\n', '0907.sql').length, 1);
  assert.equal(scanCompatibility("execute 'alter table a rename to b';\n", '0908.sql').length, 1);
  assert.equal(scanCompatibility("execute 'drop policy p on t';\n", '0909.sql').length, 1);
});

test('the generated initial schema is exempt; the same SQL in any other file is not', () => {
  const header = '-- Karma Community — production baseline.\n';
  const sql = `${header}truncate public.t;\n`;
  const dir = mkdtempSync(join(tmpdir(), 'kc-safety-initial-'));
  try {
    writeFileSync(join(dir, '0001_baseline.sql'), sql);
    assert.equal(checkMigrationSafety(dir).ok, true);
    assert.deepEqual(checkReleaseMigrations([{ name: '0001_baseline.sql', content: sql }], ''), []);
    writeFileSync(join(dir, '0002_later.sql'), 'truncate public.t;\n');
    assert.equal(checkMigrationSafety(dir).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(isInitialSchema('0001_baseline.sql', 'truncate public.t;\n'), false, 'a file without the generated header is scanned');
  assert.equal(isInitialSchema('0002_x.sql', sql), false);
});

test('release scan covers only migration files directly under supabase/migrations', () => {
  assert.equal(isScannedMigrationPath('supabase/migrations/0002_later.sql'), true);
  // The retired chain is history and never applied (D-228); a git `*` pathspec would match it.
  assert.equal(isScannedMigrationPath('supabase/migrations/archive/0004_ride_series_schedule.sql'), false);
  assert.equal(isScannedMigrationPath('supabase/migrations/notes.md'), false);
});
