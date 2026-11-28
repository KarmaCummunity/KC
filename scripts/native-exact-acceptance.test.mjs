import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateTarget, chooseDevice, cleanCandidate, verifyBuildConfig } from './native-exact-acceptance.mjs';
const sha = '02cf8dc342de36ad8e229f6537d5ea10c0a0dfc0';
const url = 'https://10978250.karma-community.pages.dev';
test('target requires exact matching source and immutable dev URL', () => {
  assert.equal(validateTarget(sha, url, { sha }).source, sha);
  for (const bad of ['main', 'dev', sha.toUpperCase(), '', 'a'.repeat(39)]) assert.throws(() => validateTarget(bad, url, { sha }));
  for (const bad of ['https://dev.karma-community.pages.dev', 'https://karma-community-kc.com', 'http://10978250.karma-community.pages.dev', url + '/path', url + '?token=x', 'https://10978250.karma-community.pages.dev.evil.test']) assert.throws(() => validateTarget(sha, bad, { sha }));
  assert.throws(() => validateTarget(sha, url, { sha: 'b'.repeat(40) }));
});
test('device family cannot silently fall back', () => {
  const devices = { devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-1': [{ name: 'iPhone 17', udid: 'phone', deviceTypeIdentifier: 'phone-type', isAvailable: true }, { name: 'iPad Air', udid: 'pad', deviceTypeIdentifier: 'pad-type', isAvailable: true }] } };
  assert.equal(chooseDevice(devices, 'iPad').udid, 'pad');
  assert.equal(chooseDevice(devices, 'iPhone').udid, 'phone');
  assert.throws(() => chooseDevice({ devices: {} }, 'iPad'));
  assert.throws(() => chooseDevice(devices, 'Mac'));
});
test('source attestation rejects tracked edits and wrong commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'kc-native-source-test-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Synthetic Test'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'app.txt'), 'unchanged'); git('add', '.'); git('commit', '-qm', 'synthetic test');
  const commit = git('rev-parse', 'HEAD');
  assert.equal(cleanCandidate(root, commit).trackedDiff, false);
  assert.throws(() => cleanCandidate(root, sha));
  writeFileSync(join(root, 'app.txt'), 'changed'); assert.throws(() => cleanCandidate(root, commit));
});
test('workflow keeps candidate independent and ciphertext-only', () => {
  const y = readFileSync('.github/workflows/native-exact-acceptance.yml', 'utf8');
  assert.match(y, /ref: 02cf8dc342de36ad8e229f6537d5ea10c0a0dfc0/);
  assert.match(y, /package-manager-cache: false/);
  assert.match(y, /--skip-dependency-update expo,react-native/);
  assert.match(y, /path: tooling/); assert.match(y, /path: candidate/);
  assert.match(y, /node .*native-exact-acceptance.mjs.* source/);
  assert.match(y, /crypto-probe\.cms/);
  assert.match(y, /native-exact-evidence\.cms/);
  assert.doesNotMatch(y, /ipad-qualification-startup|ax-probe\.mjs|E2E_SEED_PASSWORD|ASC_API|KC_SECURE_STORAGE_PROBE|KC_PUSH_SIMULATOR_TEST|workflow_run:|pull_request:|continue-on-error|tee /);
  assert.equal((y.match(/actions\/upload-artifact@/g) ?? []).length, 1);
  assert.match(y, /path: \$\{\{ runner.temp \}\}\/native-exact-evidence\.cms/);
});
test('independent runner uses one launch and no coordinate/reset fallback', () => {
  const swift = readFileSync('tests/native/exact/RawAXTests.swift', 'utf8');
  assert.equal((swift.match(/app\.launch\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(swift, /coordinate|clearState|terminate\(|activate\(/);
  for (const stage of ['welcome', 'list', 'detail', 'returned-list']) assert.ok(swift.includes(`capture("${stage}")`));
  assert.match(swift, /XCUIScreen.main.screenshot/);
});

test('resolved build config proves embedded source and disables probes/OTA', () => {
  const config = { extra: { gitCommitSha: sha.slice(0,7), pushSimulatorEnabled: false, secureStorageProbeEnabled: false, supabaseConfigured: true }, updates: { enabled: false } };
  assert.equal(verifyBuildConfig(config, sha).otaEnabled, false);
  assert.throws(() => verifyBuildConfig(config, 'b'.repeat(40)));
  assert.throws(() => verifyBuildConfig({ ...config, updates: { enabled: true } }, sha));
  assert.throws(() => verifyBuildConfig({ ...config, extra: { ...config.extra, pushSimulatorEnabled: true } }, sha));
});
