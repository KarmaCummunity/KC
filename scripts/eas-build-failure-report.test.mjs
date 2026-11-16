import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBuildId, parseLogLines, failingPhase, summarize } from './eas-build-failure-report.mjs';

const ID = 'cc93cd14-0d1c-47bb-b45f-e09ff742ce33';

test('findBuildId reads the id from eas stderr or a bare uuid', () => {
  assert.equal(findBuildId(`See logs: https://expo.dev/accounts/a/projects/b/builds/${ID}\n`), ID);
  assert.equal(findBuildId(ID), ID);
  assert.equal(findBuildId('no build here'), null);
});

test('failingPhase picks the first phase that ended with fail, not FAIL_BUILD', () => {
  const log = [
    { marker: 'START_PHASE', phase: 'INSTALL' },
    { marker: 'END_PHASE', phase: 'INSTALL', result: 'success' },
    { marker: 'START_PHASE', phase: 'RUN_GRADLEW' },
    { phase: 'RUN_GRADLEW', msg: 'FAILURE: Build failed with an exception.' },
    { marker: 'END_PHASE', phase: 'RUN_GRADLEW', result: 'fail' },
    { marker: 'START_PHASE', phase: 'FAIL_BUILD' },
    { phase: 'FAIL_BUILD', msg: 'Build failed: Gradle build failed with unknown error.' },
    { marker: 'END_PHASE', phase: 'FAIL_BUILD', result: 'fail' },
  ]
    .map((o) => JSON.stringify(o))
    .join('\n');
  const entries = parseLogLines(log);
  assert.equal(failingPhase(entries), 'RUN_GRADLEW');
  const s = summarize(entries);
  assert.deepEqual(s.hits, ['FAILURE: Build failed with an exception.']);
});

test('parseLogLines keeps non-JSON lines as plain messages', () => {
  const e = parseLogLines('plain error line\n');
  assert.equal(e[0].msg, 'plain error line');
  assert.equal(e[0].phase, null);
});
