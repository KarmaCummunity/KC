import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const workflow = readFileSync(new URL('../.github/workflows/testflight-ios.yml', import.meta.url), 'utf8');
test('simulator mode is explicit and cannot upload a store build', () => {
  assert.match(workflow, /simulator_only:\n[\s\S]*?type: boolean\n        default: false/);
  assert.match(workflow, /testflight:\n    if: inputs.simulator_only != true/);
  const job = workflow.split('  ios-simulator:')[1];
  assert.match(job, /workflow_dispatch.*inputs.simulator_only == true.*github.ref != 'refs\/heads\/main'/);
  assert.match(job, /runs-on: macos-latest/);
  assert.doesNotMatch(job, /secrets\.|eas submit|mobile-store|backend: prod/);
  assert.match(job, /simctl bootstatus/);
  assert.match(job, /-sdk iphonesimulator -destination/);
  assert.match(job, /CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build/);
  assert.match(job, /simctl install/);
  assert.match(job, /native-launch.png/);
  assert.match(job, /No remote push, account login or logout proof/);
});
test('boot has its own timeout and simulator transport opt-in cannot change a store binary', () => {
  assert.match(workflow, /Boot an available iPhone simulator\n        timeout-minutes: 10/);
  const config = readFileSync(new URL('../app/apps/mobile/app.config.ts', import.meta.url), 'utf8');
  assert.match(config, /pushSimulatorEnabled: isE2eBuild\(\) &&/);
  assert.match(config, /KC_PUSH_SIMULATOR_TEST === '1'/);
  assert.match(config, /EXPO_PUBLIC_ENVIRONMENT === 'development'/);
  assert.match(config, /EXPO_PUBLIC_STORE_BUILD !== 'true'/);
});

test('unsigned build has bounded runtime and streams forward progress while preserving failure status', () => {
  const job = workflow.split('  ios-simulator:')[1];
  assert.match(job, /Build and install unsigned simulator app\n        timeout-minutes: 45/);
  assert.match(job, /set -euo pipefail/);
  assert.match(job, /2>&1 \| tee "\$RUNNER_TEMP\/ios-simulator\/build.log"/);
});

test('secure-storage probe is DEV/E2E/non-store-gated and bounded, with entitlement evidence', () => {
  const job = workflow.split('  ios-simulator:')[1];
  assert.match(job, /KC_SECURE_STORAGE_PROBE: '1'/);
  assert.match(job, /secure-storage-probe.log/);
  assert.match(job, /entitlements.txt/);
  assert.doesNotMatch(job, /AsyncStorage/);
  const config = readFileSync(new URL('../app/apps/mobile/app.config.ts', import.meta.url), 'utf8');
  assert.match(config, /secureStorageProbeEnabled: isE2eBuild\(\) &&/);
  assert.match(config, /KC_SECURE_STORAGE_PROBE === '1'/);
});

test('probe qualification: launch-anchored bounded capture, tested parser decides, fail-closed', () => {
  const job = workflow.split('  ios-simulator:')[1];
  assert.match(job, /SIM_LAUNCH_TIME=\$\(date -u /);
  assert.match(job, /\+0000/);
  assert.match(job, /node scripts\/simulator-probe-capture\.mjs "\$LOG_FILE" "\$SIMULATOR_UDID" "\$SIM_LAUNCH_TIME" "\$cap"/);
  assert.match(job, /timeout-minutes: 3/);
  const probeStep = job.split('Capture secure-storage probe evidence')[1] ?? '';
  assert.doesNotMatch(probeStep, /python3/, 'probe capture uses the tested helper, not inline python in YAML');
  assert.match(job, /deadline=\$\(\(SECONDS \+ 90\)\)/);
  assert.match(job, /node scripts\/simulator-probe-outcome\.mjs "\$LOG_FILE"/);
  assert.doesNotMatch(job, /\| grep -q/);
  assert.match(job, /secure-storage-probe.log/);
  assert.match(job, /entitlements.txt/);
});
