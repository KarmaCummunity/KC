#!/usr/bin/env node
// Behavior fixtures for the bounded capture helper (#856): the timeout must genuinely kill
// a child that ignores everything, partial output must survive, and bad usage must fail
// closed. Uses an injectable command so no macOS simulator is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, capture } from './simulator-probe-capture.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'probe-capture-'));
const NODE = process.execPath;

test('captures child output into the log file and exits with the child code', async () => {
  const dir = tmp();
  const log = join(dir, 'probe.log');
  const parsed = parseArgs([log, 'UDID', '2026-11-21 09:00:00+0000', '5'],
    { KC_PROBE_CAPTURE_CMD: NODE, KC_PROBE_CAPTURE_ARGS: JSON.stringify(['-e', 'process.stdout.write("KC_PROBE_STORAGE_OK sentinel-856")']) });
  const code = await capture(parsed);
  assert.equal(code, 0);
  assert.match(readFileSync(log, 'utf8'), /KC_PROBE_STORAGE_OK sentinel-856/);
  rmSync(dir, { recursive: true, force: true });
});

test('hard timeout: a child that never exits is SIGKILLed within the cap', async () => {
  const dir = tmp();
  const log = join(dir, 'probe.log');
  const started = Date.now();
  const parsed = parseArgs([log, 'UDID', '2026-11-21 09:00:00+0000', '1'],
    { KC_PROBE_CAPTURE_CMD: NODE, KC_PROBE_CAPTURE_ARGS: JSON.stringify(['-e', 'setInterval(()=>{},1000)']) });
  const code = await capture(parsed);
  const elapsed = Date.now() - started;
  assert.equal(code, 0, 'timeout is not an error; the outcome parser reads the file');
  assert.ok(elapsed < 5000, `killed within the 1s cap (took ${elapsed}ms)`);
  rmSync(dir, { recursive: true, force: true });
});

test('partial output written before the kill survives in the file', async () => {
  const dir = tmp();
  const log = join(dir, 'probe.log');
  const parsed = parseArgs([log, 'UDID', '2026-11-21 09:00:00+0000', '1'],
    { KC_PROBE_CAPTURE_CMD: NODE, KC_PROBE_CAPTURE_ARGS: JSON.stringify(['-e', 'process.stdout.write("partial-line");setInterval(()=>{},1000)']) });
  await capture(parsed);
  assert.match(readFileSync(log, 'utf8'), /partial-line/);
  rmSync(dir, { recursive: true, force: true });
});

test('a missing command resolves to 0 with an error note in the file (never throws)', async () => {
  const dir = tmp();
  const log = join(dir, 'probe.log');
  const parsed = parseArgs([log, 'UDID', '2026-11-21 09:00:00+0000', '1'],
    { KC_PROBE_CAPTURE_CMD: '/nonexistent/xcrun-fake', KC_PROBE_CAPTURE_ARGS: '' });
  const code = await capture(parsed);
  assert.equal(code, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('usage validation: missing or malformed args fail closed with null', () => {
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['f.log', 'UDID']), null);
  assert.equal(parseArgs(['f.log', 'UDID', '2026-11-21 09:00:00+0000', 'abc']), null);
  assert.equal(parseArgs(['f.log', 'UDID', '2026-11-21 09:00:00+0000', '0']), null);
  const ok = parseArgs(['f.log', 'UDID', '2026-11-21 09:00:00+0000', '30']);
  assert.equal(ok.cap, 30);
  assert.deepEqual(ok.args.slice(0, 3), ['simctl', 'spawn', 'UDID']);
  assert.ok(ok.args.includes('--start') && ok.args.includes('2026-11-21 09:00:00+0000'));
});
