import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_EXCEPTION_DAYS,
  evaluate,
  parseIsoDate,
  validateAllowlist,
} from './check-dependency-audit-policy.mjs';

const VALID = Object.freeze({
  advisory: 'GHSA-r28c-9q8g-f849',
  package: 'postcss',
  reason: 'Pinned by the bundler; build time only, on the repository CSS.',
  reviewed: '2026-11-03',
  expires: '2027-01-31',
});

function finding(overrides = {}) {
  return {
    advisory: 'GHSA-r28c-9q8g-f849',
    severity: 'high',
    title: 't',
    url: 'u',
    package: 'postcss',
    version: '8.4.49',
    sources: ['app/pnpm-lock.yaml'],
    ...overrides,
  };
}

test('the committed allowlist is valid', () => {
  const document = JSON.parse(readFileSync(new URL('./check-dependency-audit.allowlist.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateAllowlist(document).errors, []);
});

test('parseIsoDate accepts real dates and rejects rollovers and other formats', () => {
  assert.equal(parseIsoDate('2027-01-31'), Date.UTC(2027, 0, 31));
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.equal(parseIsoDate('31/01/2027'), null);
  assert.equal(parseIsoDate(undefined), null);
});

test('validateAllowlist accepts a complete entry', () => {
  const result = validateAllowlist({ exceptions: [VALID] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.exceptions, [VALID]);
});

test('validateAllowlist requires the exceptions array', () => {
  assert.equal(validateAllowlist({}).errors.length, 1);
  assert.equal(validateAllowlist(null).errors.length, 1);
});

test('validateAllowlist rejects missing reasons, bad IDs and unknown fields', () => {
  const { errors, exceptions } = validateAllowlist({
    exceptions: [{ ...VALID, advisory: 'CVE-2026-1', reason: 'short', expiry: '2027-01-01' }],
  });
  assert.equal(exceptions.length, 0);
  assert.ok(errors.some((e) => /unknown field "expiry"/.test(e)));
  assert.ok(errors.some((e) => /GHSA ID/.test(e)));
  assert.ok(errors.some((e) => /"reason"/.test(e)));
});

test(`validateAllowlist caps an exception at ${MAX_EXCEPTION_DAYS} days after its review`, () => {
  const tooLong = validateAllowlist({ exceptions: [{ ...VALID, expires: '2027-02-02' }] });
  assert.ok(tooLong.errors.some((e) => /at most 90 days/.test(e)));
  const atCap = validateAllowlist({ exceptions: [{ ...VALID, expires: '2027-02-01' }] });
  assert.deepEqual(atCap.errors, []);
  const backwards = validateAllowlist({ exceptions: [{ ...VALID, expires: '2026-11-03' }] });
  assert.ok(backwards.errors.some((e) => /after "reviewed"/.test(e)));
});

test('validateAllowlist rejects duplicate advisory/package pairs', () => {
  const { errors } = validateAllowlist({ exceptions: [VALID, { ...VALID }] });
  assert.ok(errors.some((e) => /duplicate exception/.test(e)));
});

test('evaluate blocks an uncovered high finding and reports moderate ones only', () => {
  const verdict = evaluate(
    [finding({ severity: 'critical' }), finding({ advisory: 'GHSA-aaaa-bbbb-cccc', severity: 'moderate' })],
    [],
    '2026-11-03',
  );
  assert.equal(verdict.blocking.length, 1);
  assert.equal(verdict.informational.length, 1);
  assert.equal(verdict.excepted.length, 0);
});

test('evaluate excepts a covered finding through its expiry day', () => {
  const verdict = evaluate([finding()], [VALID], '2027-01-31');
  assert.equal(verdict.blocking.length, 0);
  assert.equal(verdict.excepted[0].exception, VALID);
});

test('evaluate blocks again once the exception has expired', () => {
  const verdict = evaluate([finding()], [VALID], '2027-02-01');
  assert.equal(verdict.blocking.length, 1);
  assert.equal(verdict.blocking[0].expiredException, VALID);
  assert.deepEqual(verdict.stale, []);
});

test('evaluate matches on the package too, not only the advisory ID', () => {
  const verdict = evaluate([finding({ package: 'other' })], [VALID], '2026-11-03');
  assert.equal(verdict.blocking.length, 1);
  assert.deepEqual(verdict.stale, [VALID]);
});

test('evaluate marks an exception stale when only a moderate finding matches it', () => {
  const verdict = evaluate([finding({ severity: 'moderate' })], [VALID], '2026-11-03');
  assert.deepEqual(verdict.stale, [VALID]);
});

test('evaluate rejects a malformed day instead of guessing', () => {
  assert.throws(() => evaluate([], [], '03/11/2026'), RangeError);
});
