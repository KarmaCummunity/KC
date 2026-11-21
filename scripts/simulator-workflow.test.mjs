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
  assert.match(job, /expo run:ios.*--configuration Release --no-bundler/);
  assert.match(job, /native-launch.png/);
  assert.match(job, /No remote push, account login or logout proof/);
});
