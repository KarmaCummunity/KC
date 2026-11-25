import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseIPad } from './ipad-qualification-device.mjs';

test('device selection prefers review model and never falls back to iPhone', () => {
  const selected = chooseIPad({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [
    { name: 'iPhone 17', udid: 'phone' }, { name: 'iPad Pro', udid: 'pro' },
    { name: 'iPad Air 11-inch (M3)', udid: 'review' },
  ] } });
  assert.equal(selected.udid, 'review'); assert.equal(selected.exactReviewModel, true);
  assert.throws(() => chooseIPad({ devices: { iOS: [{ name: 'iPhone', udid: 'phone' }] } }));
  assert.throws(() => chooseIPad({ devices: { iOS: [{ name: 'iPad', udid: 'x', isAvailable: false }] } }));
});
test('other iPad is identified honestly, never marked exact review hardware', () => {
  assert.equal(chooseIPad({ devices: { iOS: [{ name: 'iPad Pro', udid: 'pro' }] } }).exactReviewModel, false);
});
test('qualification is free standard DEV-only compute without account or store capability', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ipad-guest-qualification.yml', import.meta.url), 'utf8');
  assert.match(workflow, /runs-on: macos-latest/);
  assert.match(workflow, /github.ref != 'refs\/heads\/main'/);
  assert.match(workflow, /head.repo.full_name == github.repository/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /secrets\.|upload-artifact|actions\/cache|cache:|setup-pnpm-turbo|eas build|eas submit|backend: prod/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO/);
  assert.match(workflow, /openssl cms -encrypt/);
  assert.match(workflow, /base64 < "\$RUNNER_TEMP\/ipad-evidence.cms"/);
  assert.doesNotMatch(workflow, /base64 < .*\.png|cat .*interaction.log|tail .*build.log/);
});
test('native flow requires real post content and detail, not only sign-in button', () => {
  const flow = readFileSync(new URL('../tests/native/ipad-guest-qualification.yaml', import.meta.url), 'utf8');
  assert.match(flow, /all: deny/);
  assert.match(flow, /id: auth-guest-entry/);
  assert.match(flow, /id: guest-post-\.\*/);
  assert.match(flow, /id: guest-back/);
  assert.match(flow, /ipad-guest-detail/);
  assert.doesNotMatch(flow, /inputText|create-post|push-gate-accept\s*\n- tapOn/);
});

test('encrypted export bounds large build logs and screenshots instead of losing all failure evidence', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ipad-guest-qualification.yml', import.meta.url), 'utf8');
  assert.match(workflow, /tail -c 131072/);
  assert.match(workflow, /sips -Z 1600 -s format jpeg/);
  assert.match(workflow, /sed -n '1,8p'/);
  assert.match(workflow, /ipad-evidence-compact/);
  assert.match(workflow, /Encrypted evidence bytes/);
});

test('startup failure keeps private native crash reports and simulator log before runner cleanup', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ipad-guest-qualification.yml', import.meta.url), 'utf8');
  assert.match(workflow, /DiagnosticReports/);
  assert.match(workflow, /crash-report/);
  assert.match(workflow, /log show --last 8m/);
  assert.match(workflow, /process == "KC"/);
  assert.match(workflow, /capture_native_diagnostics/);
});
