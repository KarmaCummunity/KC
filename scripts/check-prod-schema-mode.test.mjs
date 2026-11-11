// Unit tests for scripts/check-prod-schema-mode.mjs.
// Run: node --test scripts/check-prod-schema-mode.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANIFEST_REL,
  checkProdSchemaMode,
  listMigrationFiles,
  loadAllowedManifest,
  loadProdSchemaContext,
  normalizeProdSchemaMode,
  parseAllowedManifest,
} from './check-prod-schema-mode.mjs';

const LEGACY = ['0001_init.sql', '0002_next.sql', '0718_last.sql'];
const BASELINE = ['0001_baseline.sql'];

function result(mode, migrations, allowed) {
  return checkProdSchemaMode({ mode, migrations, allowed });
}

test('normalizeProdSchemaMode defaults empty or whitespace to block', () => {
  assert.equal(normalizeProdSchemaMode(undefined), 'block');
  assert.equal(normalizeProdSchemaMode(''), 'block');
  assert.equal(normalizeProdSchemaMode('  '), 'block');
  assert.equal(normalizeProdSchemaMode('BASELINE'), 'baseline');
  assert.equal(normalizeProdSchemaMode(' legacy '), 'legacy');
});

test('default / block refuses any prod push, including an empty tree', () => {
  const blocked = result('block', LEGACY, []);
  assert.equal(blocked.ok, false);
  assert.match(blocked.errors[0], /D-228/);
  assert.match(blocked.errors[0], /3 file\(s\)/);
  assert.match(blocked.errors[0], /unset\/block/);
  assert.equal(result('block', [], []).ok, false);
});

test('an unknown mode is refused', () => {
  const r = result('squash', LEGACY, []);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /not a recognized mode/);
});

test('baseline refuses legacy files that are not in the approved manifest', () => {
  const r = result('baseline', LEGACY, []);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /3 file\(s\) not listed/);
  assert.match(r.errors[0], /0001_init\.sql/);
});

test('baseline allows an exact manifest match and rejects extras or missing files', () => {
  assert.equal(result('baseline', BASELINE, BASELINE).ok, true);
  assert.equal(result('baseline', [], []).ok, true);
  const extra = result('baseline', [...BASELINE, '0718_legacy.sql'], BASELINE);
  assert.equal(extra.ok, false);
  assert.match(extra.errors[0], /0718_legacy\.sql/);
  const missing = result('baseline', [], BASELINE);
  assert.equal(missing.ok, false);
  assert.match(missing.errors[0], /0001_baseline\.sql/);
});

test('legacy allows the current tree as an explicit D-228 exception and warns', () => {
  const r = result('legacy', LEGACY, []);
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
  assert.match(r.warnings[0], /explicit exception to D-228/);
  assert.match(r.warnings[0], /3 migration/);
});

test('parseAllowedManifest ignores comments and blank lines', () => {
  assert.deepEqual(
    parseAllowedManifest('# head\n\n0001_baseline.sql\n  # skip\n0002_follow.sql\n'),
    ['0001_baseline.sql', '0002_follow.sql'],
  );
});

test('the committed manifest lists exactly the migrations in the tree; prod stays blocked by default', () => {
  const root = join(import.meta.dirname, '..');
  const allowed = loadAllowedManifest(root);
  const migrations = listMigrationFiles(root);
  // Each forward-only migration after the cut-over is listed here with the PR that adds it (docs/db/cutover-runbook.md).
  const expected = [
    '0001_baseline.sql', '0002_org_entitlements.sql', '0003_org_sec46_machine.sql',
    '0004_post_series.sql', '0005_post_series_rpcs.sql', '0006_series_feed_folding.sql',
  ];
  assert.deepEqual(allowed, expected, 'the manifest approves the baseline and the forward-only migrations');
  assert.deepEqual(migrations, expected, 'supabase/migrations holds the baseline and the forward-only migrations (legacy chain is in archive/)');
  const blocked = checkProdSchemaMode({ mode: 'block', migrations, allowed });
  assert.equal(blocked.ok, false, 'unset / block still refuses a prod push');
  assert.equal(checkProdSchemaMode({ mode: 'baseline', migrations, allowed }).ok, true);
  const extra = checkProdSchemaMode({ mode: 'baseline', migrations: [...migrations, '9999_x.sql'], allowed });
  assert.equal(extra.ok, false, 'a migration the manifest does not list is refused');
  assert.match(extra.errors[0], /1 file\(s\) not listed/);
});

test('loadProdSchemaContext reads mode, migrations and the manifest from a tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'kc-schema-mode-'));
  mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
  mkdirSync(join(root, 'supabase/baseline'), { recursive: true });
  writeFileSync(join(root, 'supabase/migrations/0001_baseline.sql'), '--\n');
  writeFileSync(join(root, MANIFEST_REL), '# c\n0001_baseline.sql\n');
  const ctx = loadProdSchemaContext({ root, env: { KC_PROD_SCHEMA_MODE: 'baseline' } });
  assert.deepEqual(ctx, { mode: 'baseline', migrations: ['0001_baseline.sql'], allowed: ['0001_baseline.sql'] });
  assert.equal(checkProdSchemaMode(ctx).ok, true);
  assert.equal(loadProdSchemaContext({ root, env: {} }).mode, 'block');
});
