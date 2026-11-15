import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkMigrationChain } from './check-migration-chain.mjs';

test('accepts ordered unique migration prefixes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
  try {
    writeFileSync(join(dir, '0001_init.sql'), '-- ok');
    writeFileSync(join(dir, '0002_next.sql'), '-- ok');
    assert.deepEqual(checkMigrationChain(dir), { ok: true, errors: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects duplicate migration prefix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-dup-'));
  try {
    writeFileSync(join(dir, '0001_a.sql'), '-- a');
    writeFileSync(join(dir, '0001_b.sql'), '-- b');
    const result = checkMigrationChain(dir);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /duplicate prefix.*0001/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects invalid filename pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-bad-'));
  try {
    writeFileSync(join(dir, 'init_users.sql'), '-- bad');
    const result = checkMigrationChain(dir);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /invalid migration filename/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts pending files and ignores them in the prefix check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-pending-'));
  try {
    writeFileSync(join(dir, '0001_init.sql'), '-- ok');
    writeFileSync(join(dir, 'next-01_a.sql'), '-- ok');
    writeFileSync(join(dir, 'next-01_b.sql'), '-- ok');
    assert.deepEqual(checkMigrationChain(dir), { ok: true, errors: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a malformed or repeated pending migration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-pending-bad-'));
  try {
    writeFileSync(join(dir, 'next-1_a.sql'), '-- bad');
    writeFileSync(join(dir, 'next-01_b.sql'), '-- b');
    writeFileSync(join(dir, 'next-02_b.sql'), '-- b again');
    const result = checkMigrationChain(dir);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /invalid pending migration filename: next-1_a\.sql/);
    assert.match(result.errors.join('\n'), /duplicate pending migration slug "b"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
