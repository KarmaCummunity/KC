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
  assert.match(workflow, /CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES/);
  assert.match(workflow, /CODE_SIGN_IDENTITY="-" DEVELOPMENT_TEAM=""/);
  assert.match(workflow, /codesign --verify --deep --strict/);
  assert.doesNotMatch(workflow, /allowProvisioningUpdates|security import|PROVISIONING_PROFILE_SPECIFIER=/);
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

test('direct native launch is captured separately before Maestro clear-state launch', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ipad-guest-qualification.yml', import.meta.url), 'utf8');
  assert.match(workflow, /Direct native launch diagnostic before interaction runner/);
  assert.match(workflow, /direct-launch-screen.png/);
  assert.match(workflow, /direct-launch-console.log/);
  assert.ok(workflow.indexOf('Direct native launch diagnostic') < workflow.indexOf('Real native guest interaction'));
});


test('warm relaunch control preserves initial failure and never clears persisted RTL state', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ipad-guest-qualification.yml', import.meta.url), 'utf8');
  assert.match(workflow, /initial_status=0/);
  assert.match(workflow, /warm-interaction.log/);
  assert.match(workflow, /clearState: false/);
  assert.match(workflow, /exit "\$initial_status"/);
  assert.match(workflow, /warm-console.log/);
});


test('warm comparison uses visible guest link and preserves startup markers before log bounds', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ipad-guest-qualification.yml', import.meta.url), 'utf8');
  assert.match(workflow, /Browse without an account/);
  assert.match(workflow, /צפייה ללא חשבון/);
  assert.match(workflow, /startup-markers.log/);
  assert.match(workflow, /source-pr-head.txt/);
});


test('actual accessibility hierarchy and nested runner diagnostics remain bounded and encrypted', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ipad-guest-qualification.yml', import.meta.url), 'utf8');
  assert.match(workflow, /maestro --device "\$SIMULATOR_UDID" hierarchy/);
  assert.match(workflow, /nested-evidence-paths\.txt/);
  assert.match(workflow, /head -40/);
  assert.match(workflow, /tail -c 131072 "\$diagnostic"/);
  assert.ok(workflow.indexOf('nested-evidence-paths.txt') < workflow.indexOf('openssl cms -encrypt'));
  assert.doesNotMatch(workflow, /upload-artifact|cat .*hierarchy|cat .*nested-/);
});
test('guest entry is scrolled fully into view before selector tap without coordinate fallback', () => {
  const flow = readFileSync(new URL('../tests/native/ipad-guest-qualification.yaml', import.meta.url), 'utf8');
  assert.match(flow, /scrollUntilVisible:[\s\S]*id: auth-guest-entry[\s\S]*visibilityPercentage: 100/);
  assert.ok(flow.indexOf('scrollUntilVisible') < flow.indexOf('- tapOn:'));
  assert.doesNotMatch(flow, /point:|optional: true/);
  assert.match(flow, /id: guest-post-\.\*/);
  assert.match(flow, /ipad-guest-detail/);
});
