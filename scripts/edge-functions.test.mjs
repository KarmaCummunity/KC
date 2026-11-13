// Unit tests for scripts/edge-functions.mjs. Run: node --test scripts/edge-functions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LOCAL_ONLY, NOT_DEPLOYED, SMOKE_PROBES, inactiveFunctions, listDeployableFunctions } from './edge-functions.mjs';

function makeFunctionsDir(layout) {
  const dir = mkdtempSync(join(tmpdir(), 'edge-fns-'));
  for (const [name, files] of Object.entries(layout)) {
    mkdirSync(join(dir, name));
    for (const f of files) writeFileSync(join(dir, name, f), '');
  }
  return dir;
}

test('lists function directories with an index.ts, sorted', () => {
  const dir = makeFunctionsDir({ translate: ['index.ts'], 'strip-exif': ['index.ts', 'deno.json'] });
  try {
    assert.deepEqual(listDeployableFunctions(dir), ['strip-exif', 'translate']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips shared code and directories without an entry point', () => {
  const dir = makeFunctionsDir({ _shared: ['cors.ts'], drafts: ['notes.md'], translate: ['index.ts'] });
  try {
    assert.deepEqual(listDeployableFunctions(dir), ['translate']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the real tree deploys every function except the local-only ones', () => {
  const names = listDeployableFunctions();
  assert.ok(names.length > 0);
  for (const local of LOCAL_ONLY) assert.ok(!names.includes(local), `${local} must not deploy`);
});

test('skips the functions switched off in the pipeline', () => {
  const dir = makeFunctionsDir({ 'parked-fn': ['index.ts'], translate: ['index.ts'] });
  NOT_DEPLOYED.set('parked-fn', 'test');
  try {
    assert.deepEqual(listDeployableFunctions(dir), ['translate']);
  } finally {
    NOT_DEPLOYED.delete('parked-fn');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('NOT_DEPLOYED names a reason for each entry and overlaps neither LOCAL_ONLY nor the smoke probes', () => {
  for (const [name, reason] of NOT_DEPLOYED) {
    assert.ok(reason.length > 0, name);
    assert.ok(!LOCAL_ONLY.has(name), `${name} is in both lists`);
    assert.ok(!(name in SMOKE_PROBES), `${name} is not deployed, so it has no smoke probe`);
  }
});

test('the real tree deploys the WhatsApp bot functions and no NOT_DEPLOYED one', () => {
  const names = listDeployableFunctions();
  assert.deepEqual(names.filter((n) => n.startsWith('whatsapp-')), ['whatsapp-sender', 'whatsapp-webhook']);
  for (const n of NOT_DEPLOYED.keys()) assert.ok(!names.includes(n), `${n} must not deploy`);
});

test('every deployable function declares how the smoke may probe it', () => {
  assert.deepEqual(Object.keys(SMOKE_PROBES).sort(), listDeployableFunctions());
  for (const [name, probe] of Object.entries(SMOKE_PROBES)) {
    if (probe === null) continue;
    assert.ok(probe.expect.length > 0 && probe.expect.every((s) => s >= 200 && s < 500 && s !== 404), name);
    assert.ok(probe.why, name);
  }
});

test('inactiveFunctions reports functions missing or not ACTIVE', () => {
  const listed = [
    { slug: 'translate', status: 'ACTIVE' },
    { slug: 'strip-exif', status: 'THROTTLED' },
  ];
  assert.deepEqual(inactiveFunctions(listed, ['translate', 'strip-exif', 'match-rerank']), ['strip-exif', 'match-rerank']);
  assert.deepEqual(inactiveFunctions([{ name: 'translate', status: 'ACTIVE' }], ['translate']), []);
});
