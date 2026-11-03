// Unit tests for scripts/release-version.mjs. Run: node --test scripts/release-version.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkVersionBump, compareSemver, latestReleaseTag, parseSemver, planTag } from './release-version.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('parseSemver accepts X.Y.Z with or without a v prefix', () => {
  assert.deepEqual(parseSemver('1.5.3'), [1, 5, 3]);
  assert.deepEqual(parseSemver('v10.0.12'), [10, 0, 12]);
  assert.equal(parseSemver('1.5'), null);
  assert.equal(parseSemver('1.5.3-rc.1'), null);
});

test('compareSemver orders numerically, not lexically', () => {
  assert.ok(compareSemver('1.10.0', '1.9.9') > 0);
  assert.ok(compareSemver('v1.5.2', '1.5.3') < 0);
  assert.equal(compareSemver('2.0.0', 'v2.0.0'), 0);
});

test('latestReleaseTag ignores non-release tags', () => {
  assert.equal(latestReleaseTag(['v1.2.0', 'v1.10.0', 'v1.9.1', 'nightly', 'v2.0.0-rc.1']), 'v1.10.0');
  assert.equal(latestReleaseTag(['nightly']), null);
  assert.equal(latestReleaseTag([]), null);
});

test('checkVersionBump passes on the first release and on a real bump', () => {
  assert.deepEqual(checkVersionBump('1.5.3', []), []);
  assert.deepEqual(checkVersionBump('1.5.3', ['v1.5.2']), []);
  assert.deepEqual(checkVersionBump('2.0.0', ['v1.9.9']), []);
});

test('checkVersionBump fails when VERSION is equal to or below the latest tag', () => {
  assert.match(checkVersionBump('1.5.2', ['v1.5.2'])[0], /not greater than the latest release tag v1\.5\.2/);
  assert.match(checkVersionBump('1.4.9', ['v1.5.0'])[0], /not greater/);
  assert.match(checkVersionBump('1.5', [])[0], /MAJOR\.MINOR\.PATCH/);
});

test('planTag creates a new tag, accepts a re-run on the same commit, rejects a reused version', () => {
  assert.deepEqual(planTag({ version: '1.5.3', sha: A, existingSha: null }), { tag: 'v1.5.3', action: 'create' });
  assert.deepEqual(planTag({ version: '1.5.3', sha: A, existingSha: A }), { tag: 'v1.5.3', action: 'exists' });
  assert.throws(() => planTag({ version: '1.5.3', sha: A, existingSha: B }), /app\/VERSION was not bumped/);
});
