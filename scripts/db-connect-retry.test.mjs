import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isConnectFailure, parseArgs, runWithRetry } from './db-connect-retry.mjs';

const POOLER_TIMEOUT = 'failed to connect to postgres: failed to connect to `host=aws-1-eu-central-1.pooler.supabase.com user=postgres.x database=postgres`: failed to receive message (timeout: context deadline exceeded)';

function fakeRun(results) {
  const calls = [];
  return { calls, run: async (cmd) => { calls.push(cmd); return results[calls.length - 1]; } };
}
const noSleep = { sleep: async () => {}, log: () => {} };

test('recognises the pooler connect timeout seen in Deploy 43502416446', () => {
  assert.equal(isConnectFailure(POOLER_TIMEOUT), true);
});

test('does not treat a migration SQL error as a connect failure', () => {
  assert.equal(isConnectFailure('ERROR: relation "x" already exists (SQLSTATE 42P07)'), false);
  assert.equal(isConnectFailure('Remote migration versions not found in local migrations directory.'), false);
});

test('retries a connect failure and returns 0 once it connects', async () => {
  const f = fakeRun([{ code: 1, output: POOLER_TIMEOUT }, { code: 0, output: 'ok' }]);
  assert.equal(await runWithRetry({ attempts: 3, delayMs: 0, cmd: ['supabase'] }, { run: f.run, ...noSleep }), 0);
  assert.equal(f.calls.length, 2);
});

test('never retries a non-connect failure', async () => {
  const f = fakeRun([{ code: 1, output: 'ERROR: syntax error' }, { code: 0, output: '' }]);
  assert.equal(await runWithRetry({ attempts: 3, delayMs: 0, cmd: ['supabase'] }, { run: f.run, ...noSleep }), 1);
  assert.equal(f.calls.length, 1);
});

test('gives up after the attempt limit with the command exit code', async () => {
  const f = fakeRun(Array(5).fill({ code: 1, output: POOLER_TIMEOUT }));
  assert.equal(await runWithRetry({ attempts: 3, delayMs: 0, cmd: ['supabase'] }, { run: f.run, ...noSleep }), 1);
  assert.equal(f.calls.length, 3);
});

test('backs off linearly between attempts', async () => {
  const waits = [];
  const f = fakeRun([{ code: 1, output: POOLER_TIMEOUT }, { code: 1, output: POOLER_TIMEOUT }, { code: 0, output: '' }]);
  await runWithRetry({ attempts: 3, delayMs: 1000, cmd: ['x'] }, { run: f.run, sleep: async (ms) => { waits.push(ms); }, log: () => {} });
  assert.deepEqual(waits, [1000, 2000]);
});

test('parses flags and requires a command after --', () => {
  assert.deepEqual(parseArgs(['--attempts', '4', '--delay-ms', '5', '--', 'supabase', 'db', 'push']), { attempts: 4, delayMs: 5, cmd: ['supabase', 'db', 'push'] });
  assert.throws(() => parseArgs(['supabase']));
  assert.throws(() => parseArgs(['--attempts', '0', '--', 'x']));
});
