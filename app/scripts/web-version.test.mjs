import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readAppVersion, renderVersionFile, resolveBuildSha } from './web-version.mjs';

const SHA = 'a'.repeat(40);
const CI_SHA = 'b'.repeat(40);

function withVersionFile(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'web-version-'));
  try {
    writeFileSync(join(dir, 'VERSION'), content);
    return fn(join(dir, 'VERSION'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('readAppVersion trims and accepts MAJOR.MINOR.PATCH', () => {
  assert.equal(withVersionFile('1.5.3\n', readAppVersion), '1.5.3');
});

test('readAppVersion rejects anything that is not plain semver', () => {
  for (const bad of ['1.5', 'v1.5.3', '1.5.3-rc.1', '']) {
    assert.throws(() => withVersionFile(bad, readAppVersion), /MAJOR\.MINOR\.PATCH/);
  }
});

test('an explicit EXPO_PUBLIC_GIT_COMMIT_SHA wins over GITHUB_SHA', () => {
  assert.equal(resolveBuildSha({ EXPO_PUBLIC_GIT_COMMIT_SHA: ` ${SHA} `, GITHUB_SHA: CI_SHA }), SHA);
});

test('a short or malformed explicit SHA fails the build', () => {
  assert.throws(() => resolveBuildSha({ EXPO_PUBLIC_GIT_COMMIT_SHA: 'abc1234', GITHUB_SHA: CI_SHA }), /full 40-character/);
});

test('falls back to GITHUB_SHA, then to "unknown" — never to a spawned git', () => {
  assert.equal(resolveBuildSha({ GITHUB_SHA: CI_SHA }), CI_SHA);
  assert.equal(resolveBuildSha({}), 'unknown');
  assert.equal(resolveBuildSha({ EXPO_PUBLIC_GIT_COMMIT_SHA: '', GITHUB_SHA: 'not-a-sha' }), 'unknown');
});

test('renderVersionFile emits exactly version, sha and builtAt as JSON', () => {
  const body = renderVersionFile({ version: '1.5.3', sha: SHA, builtAt: '2026-10-30T00:00:00.000Z' });
  assert.deepEqual(JSON.parse(body), { version: '1.5.3', sha: SHA, builtAt: '2026-10-30T00:00:00.000Z' });
  assert.ok(body.endsWith('\n'));
});
