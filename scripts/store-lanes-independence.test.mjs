// Guards the iOS / Android split of the mobile store pipeline (NOTES §19):
// the two lanes never depend on each other, each gets only its own secrets,
// and each records its own result. Run: node --test scripts/store-lanes-independence.test.mjs
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';

const load = (name) => parse(readFileSync(`.github/workflows/${name}`, 'utf8'));
const needsOf = (job) => [job?.needs ?? []].flat();

const IOS_ONLY = ['ASC_API_KEY_ID', 'ASC_API_KEY_ISSUER_ID', 'ASC_API_KEY_P8', 'KC_IOS_TEAM_ID', 'KC_IOS_DIST_P12_B64', 'KC_IOS_DIST_P12_PASSWORD', 'SENTRY_AUTH_TOKEN'];
const ANDROID_ONLY = ['GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'];

/** [caller workflow, iOS job ids, Android job ids] */
const CALLERS = [
  ['prod-store-build.yml', ['ios'], ['android']],
  ['mobile-nightly.yml', ['ios', 'record-ios'], ['android', 'record-android']],
];

for (const [file, iosJobs, androidJobs] of CALLERS) {
  test(`${file}: iOS and Android lanes never need each other`, () => {
    const { jobs } = load(file);
    for (const id of iosJobs) {
      assert.ok(jobs[id], `${file} has job ${id}`);
      for (const other of androidJobs) assert.ok(!needsOf(jobs[id]).includes(other), `${id} must not need ${other}`);
    }
    for (const id of androidJobs) {
      assert.ok(jobs[id], `${file} has job ${id}`);
      for (const other of iosJobs) assert.ok(!needsOf(jobs[id]).includes(other), `${id} must not need ${other}`);
    }
  });

  test(`${file}: each store lane gets only its own platform's secrets`, () => {
    const { jobs } = load(file);
    const ios = jobs[iosJobs[0]];
    const android = jobs[androidJobs[0]];
    assert.equal(ios.uses, './.github/workflows/testflight-ios.yml');
    assert.equal(android.uses, './.github/workflows/play-internal.yml');
    for (const lane of [ios, android]) assert.notEqual(lane.secrets, 'inherit', 'no secrets: inherit on a store lane');
    for (const n of ANDROID_ONLY) assert.ok(!(n in (ios.secrets ?? {})), `iOS lane must not receive ${n}`);
    for (const n of IOS_ONLY) assert.ok(!(n in (android.secrets ?? {})), `Android lane must not receive ${n}`);
  });

  test(`${file}: each lane is gated by its own per-platform output`, () => {
    const { jobs } = load(file);
    assert.match(String(jobs[iosJobs[0]].if), /ios/);
    assert.doesNotMatch(String(jobs[iosJobs[0]].if), /android/);
    assert.match(String(jobs[androidJobs[0]].if), /android/);
    assert.doesNotMatch(String(jobs[androidJobs[0]].if), /ios/);
  });
}

test('store lanes declare every secret their caller passes, and nothing from the other platform', () => {
  const ios = load('testflight-ios.yml');
  const android = load('play-internal.yml');
  const iosDeclared = Object.keys(ios.on.workflow_call.secrets ?? {});
  const androidDeclared = Object.keys(android.on.workflow_call.secrets ?? {});
  for (const n of ANDROID_ONLY) assert.ok(!iosDeclared.includes(n));
  for (const n of IOS_ONLY) assert.ok(!androidDeclared.includes(n));
  for (const [file, iosJobs, androidJobs] of CALLERS) {
    const { jobs } = load(file);
    for (const n of Object.keys(jobs[iosJobs[0]].secrets ?? {})) assert.ok(iosDeclared.includes(n), `${file} passes undeclared ${n} to iOS`);
    for (const n of Object.keys(jobs[androidJobs[0]].secrets ?? {})) assert.ok(androidDeclared.includes(n), `${file} passes undeclared ${n} to Android`);
  }
});

test('store lanes keep separate, non-cancelling concurrency groups', () => {
  const ios = load('testflight-ios.yml').jobs.testflight.concurrency;
  const android = load('play-internal.yml').jobs['play-internal'].concurrency;
  assert.notEqual(ios.group, android.group);
  assert.equal(ios['cancel-in-progress'], false);
  assert.equal(android['cancel-in-progress'], false);
});

test('PROD store build and nightly can be dispatched for one platform', () => {
  for (const file of ['prod-store-build.yml', 'mobile-nightly.yml']) {
    const input = load(file).on.workflow_dispatch.inputs.platform;
    assert.deepEqual(input.options, ['both', 'ios', 'android'], file);
    assert.equal(input.default, 'both', file);
  }
});

test('EAS preview builds each platform in its own non-fail-fast job', () => {
  const job = load('kc-mobile-eas-preview.yml').jobs.preview;
  assert.equal(job.strategy['fail-fast'], false);
  assert.match(job.concurrency.group, /matrix\.platform/);
});
