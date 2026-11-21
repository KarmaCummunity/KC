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
