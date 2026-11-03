#!/usr/bin/env node
// Unit tests for the migration-drift guard. Run: node --test scripts/check-migration-drift.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRemoteVersions,
  findDrift,
  pendingMigrations,
  repairCommands,
} from './check-migration-drift.mjs';

// A realistic `supabase migration list --linked` capture with one MCP timestamp
// orphan at the tail (the exact shape observed on dev 2026-07-01).
const CLI_OUTPUT = `
   LOCAL | REMOTE         | TIME (UTC)
  -------|----------------|---------------------
   0210  | 0210           | 0210
   0211  | 0211           | 0211
   0212  | 0212           | 0212
         | 20260701130827 | 2026-07-01 13:08:27
`;

test('parseRemoteVersions keeps only all-digit REMOTE cells', () => {
  assert.deepEqual(parseRemoteVersions(CLI_OUTPUT), [
    '0210',
    '0211',
    '0212',
    '20260701130827',
  ]);
});

test('parseRemoteVersions skips header and dashed separator rows', () => {
  const versions = parseRemoteVersions(CLI_OUTPUT);
  assert.ok(!versions.includes('REMOTE'));
  assert.ok(!versions.some((v) => v.includes('-')));
});

test('parseRemoteVersions tolerates a local-only row (empty REMOTE)', () => {
  const out = `   0213  |                | \n   0212  | 0212 | 0212`;
  assert.deepEqual(parseRemoteVersions(out), ['0212']);
});

test('findDrift flags a timestamp version with no local file', () => {
  const drift = findDrift({
    localVersions: ['0210', '0211', '0212'],
    remoteVersions: ['0210', '0211', '0212', '20260701130827'],
  });
  assert.equal(drift.ok, false);
  assert.deepEqual(drift.orphans, ['20260701130827']);
  assert.deepEqual(drift.timestampOrphans, ['20260701130827']);
});

test('findDrift is clean when every remote version has a local file', () => {
  const drift = findDrift({
    localVersions: ['0210', '0211', '0212'],
    remoteVersions: ['0210', '0211', '0212'],
  });
  assert.equal(drift.ok, true);
  assert.deepEqual(drift.orphans, []);
});

test('findDrift does NOT fail on a local-only (not-yet-deployed) migration', () => {
  // 0213 committed but remote still shows the timestamp it was applied under.
  const drift = findDrift({
    localVersions: ['0212', '0213'],
    remoteVersions: ['0212', '20260701130827'],
  });
  assert.deepEqual(drift.orphans, ['20260701130827']); // only the orphan fails
  assert.deepEqual(drift.missing, ['0213']); // 0213 is "missing", not an orphan
});

test('repairCommands reverts orphans then applies the paired local files', () => {
  const cmds = repairCommands({
    orphans: ['20260701130827'],
    missing: ['0213'],
  });
  assert.deepEqual(cmds, [
    'supabase migration repair --status reverted 20260701130827',
    'supabase migration repair --status applied 0213',
  ]);
});

test('findDrift dedupes and sorts', () => {
  const drift = findDrift({
    localVersions: ['0001'],
    remoteVersions: ['0001', '20260701130827', '20260601120000', '20260701130827'],
  });
  assert.deepEqual(drift.orphans, ['20260601120000', '20260701130827']);
});

test('pendingMigrations lists the local versions db push is about to apply', () => {
  const list = ['  LOCAL | REMOTE | TIME', '  ------|--------|-----', '  0001  | 0001   | 0001', '  0002  |        | 0002'].join('\n');
  assert.deepEqual(pendingMigrations(list, ['0001', '0002', '0003']), ['0002', '0003']);
  assert.deepEqual(pendingMigrations(list, ['0001']), []);
});
