#!/usr/bin/env node
// Behavioral fixtures for the simulator probe outcome parser (#856).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeOutcome } from './simulator-probe-outcome.mjs';

const wrap = (status) => `2026-11-21 09:40:00.000 KC[1234:5678] [secure-storage-probe] ${status}`;

test('ok only → ok', () => {
  assert.equal(probeOutcome(['noise', wrap('ok'), 'more noise'].join('\n')), 'ok');
});
test('fail present → failed, even when an ok line is also present (mixed fails closed)', () => {
  assert.equal(probeOutcome([wrap('ok'), wrap('fail: boom')].join('\n')), 'failed');
  assert.equal(probeOutcome(wrap('fail: boom')), 'failed');
});
test('mismatch present → failed', () => {
  assert.equal(probeOutcome(wrap('mismatch: secure storage read-back differed')), 'failed');
});
test('malformed marker line → ambiguous (e.g. "okay" is not ok)', () => {
  assert.equal(probeOutcome(wrap('okay')), 'ambiguous');
  assert.equal(probeOutcome([wrap('ok'), wrap('')].join('\n')), 'ambiguous');
});
test('no marker at all → missing', () => {
  assert.equal(probeOutcome(''), 'missing');
  assert.equal(probeOutcome('2026-11-21 unrelated log line'), 'missing');
});
test('marker substring inside an unrelated word does not count as ok', () => {
  assert.equal(probeOutcome('x [secure-storage-probe] ok-ish'), 'ambiguous');
});
