import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyDeployRun,
  checkDispatchSha,
  decide,
  enabledErrors,
  isStoreBuildEnabled,
  tagsPointingAt,
  main,
  TAG_JOB_NAME,
  isTagJobName,
  platformEnabled,
  planPlatforms,
  requestedPlatforms,
  PLATFORM_VARS,
} from './prod-store-build-gate.mjs';

const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('isStoreBuildEnabled is true only for the exact token', () => {
  assert.equal(isStoreBuildEnabled('true'), true);
  assert.equal(isStoreBuildEnabled(' true '), true);
  assert.equal(isStoreBuildEnabled('TRUE'), false);
  assert.equal(isStoreBuildEnabled('1'), false);
  assert.equal(isStoreBuildEnabled('yes'), false);
  assert.equal(isStoreBuildEnabled(''), false);
  assert.equal(isStoreBuildEnabled(undefined), false);
  assert.ok(enabledErrors(undefined)[0].includes('KC_PROD_STORE_BUILD_ENABLED'));
  assert.deepEqual(enabledErrors('true'), []);
});

test('classifyDeployRun accepts only a successful tagged PROD Deploy on main', () => {
  const jobs = [
    { name: 'resolve target', conclusion: 'success' },
    { name: TAG_JOB_NAME, conclusion: 'success', status: 'completed' },
  ];
  const ok = classifyDeployRun({
    conclusion: 'success',
    headBranch: 'main',
    headSha: SHA,
    jobs,
  });
  assert.equal(ok.kind, 'prod-tagged');
  assert.equal(ok.sha, SHA);

  assert.equal(
    classifyDeployRun({ conclusion: 'success', headBranch: 'dev', headSha: SHA, jobs }).kind,
    'not-prod-release',
  );
  assert.equal(
    classifyDeployRun({ conclusion: 'success', headBranch: 'main', headSha: SHA, jobs: [] }).kind,
    'not-prod-release',
  );
  assert.ok(
    classifyDeployRun({
      conclusion: 'success',
      headBranch: 'main',
      headSha: SHA,
      jobs: [{ name: TAG_JOB_NAME, conclusion: 'skipped' }],
    }).reason.includes('tag release'),
  );
  assert.equal(
    classifyDeployRun({ conclusion: 'failure', headBranch: 'main', headSha: SHA, jobs }).kind,
    'not-prod-release',
  );
});

test('checkDispatchSha requires a 40-char SHA on main with a v* tag', () => {
  assert.ok(checkDispatchSha({ sha: 'short', aheadBy: 0, tags: ['v1.0.0'] }).errors[0].includes('40-character'));
  assert.ok(checkDispatchSha({ sha: SHA, aheadBy: 2, tags: ['v1.0.0'] }).errors[0].includes('not on main'));
  assert.ok(checkDispatchSha({ sha: SHA, aheadBy: 0, tags: [] }).errors[0].includes('no v* tag'));
  assert.deepEqual(checkDispatchSha({ sha: SHA, aheadBy: 0, tags: ['v1.9.5'] }).errors, []);
});

test('decide quietly skips non-prod Deploy runs and fails closed when a real release is gated off', () => {
  const skipped = decide({
    eventName: 'workflow_run',
    enabled: undefined,
    deploy: {
      conclusion: 'success',
      headBranch: 'main',
      headSha: SHA,
      jobs: [{ name: TAG_JOB_NAME, conclusion: 'skipped' }],
    },
  });
  assert.equal(skipped.quiet, true);
  assert.equal(skipped.proceed, false);

  const blocked = decide({
    eventName: 'workflow_run',
    enabled: '',
    deploy: {
      conclusion: 'success',
      headBranch: 'main',
      headSha: SHA,
      jobs: [{ name: TAG_JOB_NAME, conclusion: 'success' }],
    },
  });
  assert.equal(blocked.quiet, false);
  assert.equal(blocked.proceed, false);
  assert.ok(blocked.errors[0].includes('KC_PROD_STORE_BUILD_ENABLED'));

  const go = decide({
    eventName: 'workflow_run',
    enabled: 'true',
    deploy: {
      conclusion: 'success',
      headBranch: 'main',
      headSha: SHA,
      jobs: [{ name: TAG_JOB_NAME, conclusion: 'success' }],
    },
  });
  assert.equal(go.proceed, true);
  assert.equal(go.sha, SHA);
});

test('decide on dispatch fails closed when the flag is off even if the SHA is tagged on main', () => {
  const blocked = decide({
    eventName: 'workflow_dispatch',
    enabled: undefined,
    dispatch: { sha: SHA, aheadBy: 0, tags: ['v1.9.5'] },
  });
  assert.equal(blocked.proceed, false);
  assert.equal(blocked.quiet, false);
  assert.ok(blocked.errors.some((e) => e.includes('KC_PROD_STORE_BUILD_ENABLED')));

  const go = decide({
    eventName: 'workflow_dispatch',
    enabled: 'true',
    dispatch: { sha: SHA, aheadBy: 0, tags: ['v1.9.5'] },
  });
  assert.equal(go.proceed, true);
  assert.equal(go.tag, 'v1.9.5');
});

test('tagsPointingAt peels annotated tags', () => {
  const tagObjSha = OTHER;
  const refs = [
    { ref: 'refs/tags/v1.9.5', object: { type: 'tag', sha: tagObjSha } },
    { ref: 'refs/tags/v0.0.1', object: { type: 'commit', sha: 'cccccccccccccccccccccccccccccccccccccccc' } },
  ];
  const resolved = { [tagObjSha]: { object: { sha: SHA } } };
  assert.deepEqual(tagsPointingAt(refs, SHA, resolved), ['v1.9.5']);
});

test('main writes proceed=false and exits 0 for a skipped-only Deploy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prod-store-gate-'));
  const out = join(dir, 'output');
  writeFileSync(out, '');
  const logs = [];
  const code = await main(
    {
      EVENT_NAME: 'workflow_run',
      WORKFLOW_RUN_CONCLUSION: 'success',
      WORKFLOW_RUN_HEAD_BRANCH: 'main',
      WORKFLOW_RUN_HEAD_SHA: SHA,
    },
    {
      jobs: [{ name: TAG_JOB_NAME, conclusion: 'skipped' }],
      outputPath: out,
      fs: { appendFileSync: (p, s) => writeFileSync(p, readFileSync(p, 'utf8') + s) },
      log: { info: (m) => logs.push(m), error: (m) => logs.push(m), log: (m) => logs.push(m) },
    },
  );
  assert.equal(code, 0);
  assert.match(readFileSync(out, 'utf8'), /proceed=false/);
  assert.ok(logs.some((m) => /skipping/.test(m)));
});

test('main exits 1 for dispatch when the flag is unset', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prod-store-gate-'));
  const out = join(dir, 'output');
  writeFileSync(out, '');
  const code = await main(
    { EVENT_NAME: 'workflow_dispatch', INPUT_SHA: SHA, KC_PROD_STORE_BUILD_ENABLED: '' },
    {
      aheadBy: 0,
      tags: ['v1.9.5'],
      outputPath: out,
      fs: { appendFileSync: (p, s) => writeFileSync(p, readFileSync(p, 'utf8') + s) },
      log: { info() {}, error() {}, log() {} },
    },
  );
  assert.equal(code, 1);
  assert.match(readFileSync(out, 'utf8'), /proceed=false/);
});

test('reusable-workflow tag job name ("tag release / tag release") counts as the tag job', () => {
  assert.equal(isTagJobName('tag release'), true);
  assert.equal(isTagJobName('tag release / tag release'), true);
  assert.equal(isTagJobName('rollback (prod)'), false);
  assert.equal(isTagJobName('tag release-ish'), false);
  const sha = 'a'.repeat(40);
  const ok = classifyDeployRun({
    conclusion: 'success',
    headBranch: 'main',
    headSha: sha,
    jobs: [{ name: 'tag release / tag release', conclusion: 'success', status: 'completed' }],
  });
  assert.equal(ok.kind, 'prod-tagged');
  const skipped = classifyDeployRun({
    conclusion: 'success',
    headBranch: 'main',
    headSha: sha,
    jobs: [{ name: 'tag release / tag release', conclusion: 'skipped' }],
  });
  assert.equal(skipped.kind, 'not-prod-release');
});

const TAGGED_DEPLOY = {
  conclusion: 'success',
  headBranch: 'main',
  headSha: SHA,
  jobs: [{ name: 'tag release / tag release', conclusion: 'success' }],
};

test('platformEnabled: own var wins, unset falls back to the legacy flag, only "true" enables', () => {
  assert.equal(platformEnabled('ios', { KC_PROD_STORE_BUILD_ENABLED: 'true' }).enabled, true);
  assert.equal(platformEnabled('android', { KC_PROD_STORE_BUILD_ENABLED: 'true' }).enabled, true);
  assert.equal(platformEnabled('ios', {}).enabled, false);
  assert.equal(platformEnabled('android', { KC_PROD_STORE_BUILD_ENABLED: 'true', [PLATFORM_VARS.android]: 'false' }).enabled, false);
  assert.equal(platformEnabled('ios', { KC_PROD_STORE_BUILD_ENABLED: '', [PLATFORM_VARS.ios]: 'true' }).enabled, true);
  assert.equal(platformEnabled('ios', { KC_PROD_STORE_BUILD_ENABLED: 'true', [PLATFORM_VARS.ios]: 'TRUE' }).enabled, false);
  assert.throws(() => platformEnabled('web', {}));
});

test('requestedPlatforms accepts both / ios / android only', () => {
  assert.deepEqual(requestedPlatforms(undefined).platforms, ['ios', 'android']);
  assert.deepEqual(requestedPlatforms('both').platforms, ['ios', 'android']);
  assert.deepEqual(requestedPlatforms('ios').platforms, ['ios']);
  assert.deepEqual(requestedPlatforms('Android').platforms, ['android']);
  assert.equal(requestedPlatforms('all').errors.length, 1);
});

test('tagged release with Android disabled still builds iOS (notice, no error)', () => {
  const d = decide({
    eventName: 'workflow_run',
    enabled: 'true',
    flags: { [PLATFORM_VARS.android]: 'false' },
    deploy: TAGGED_DEPLOY,
  });
  assert.equal(d.proceed, true);
  assert.equal(d.platforms.ios.build, true);
  assert.equal(d.platforms.android.build, false);
  assert.ok(d.notices.some((n) => n.includes('Android')));
  assert.deepEqual(d.errors, []);
});

test('tagged release with both platforms disabled fails closed', () => {
  const d = decide({
    eventName: 'workflow_run',
    enabled: 'true',
    flags: { [PLATFORM_VARS.ios]: 'false', [PLATFORM_VARS.android]: 'false' },
    deploy: TAGGED_DEPLOY,
  });
  assert.equal(d.proceed, false);
  assert.equal(d.quiet, false);
  assert.ok(d.errors[0].includes('No requested platform is enabled'));
});

test('dispatch platform=ios builds only iOS; asking for a disabled platform is an error', () => {
  const ios = decide({
    eventName: 'workflow_dispatch',
    enabled: 'true',
    platform: 'ios',
    dispatch: { sha: SHA, aheadBy: 0, tags: ['v1.9.5'] },
  });
  assert.equal(ios.proceed, true);
  assert.equal(ios.platforms.ios.build, true);
  assert.equal(ios.platforms.android.build, false);
  assert.equal(ios.platforms.android.requested, false);

  const blocked = decide({
    eventName: 'workflow_dispatch',
    enabled: 'true',
    flags: { [PLATFORM_VARS.android]: 'false' },
    platform: 'android',
    dispatch: { sha: SHA, aheadBy: 0, tags: ['v1.9.5'] },
  });
  assert.equal(blocked.proceed, false);
  assert.ok(blocked.errors.some((e) => e.includes('asked for android only')));
});

test('planPlatforms rejects an unknown platform input', () => {
  const { errors } = planPlatforms({ flags: { KC_PROD_STORE_BUILD_ENABLED: 'true' }, platform: 'web' });
  assert.ok(errors.some((e) => e.includes('platform input')));
});

test('main writes per-platform outputs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prod-store-gate-'));
  const out = join(dir, 'output');
  writeFileSync(out, '');
  const code = await main(
    {
      EVENT_NAME: 'workflow_dispatch',
      INPUT_SHA: SHA,
      INPUT_PLATFORM: 'both',
      KC_PROD_STORE_BUILD_ENABLED: 'true',
      KC_PROD_STORE_BUILD_ANDROID_ENABLED: 'false',
    },
    {
      aheadBy: 0,
      tags: ['v1.9.5'],
      outputPath: out,
      fs: { appendFileSync: (p, s) => writeFileSync(p, readFileSync(p, 'utf8') + s) },
      log: { info() {}, error() {}, log() {} },
    },
  );
  assert.equal(code, 0);
  const text = readFileSync(out, 'utf8');
  assert.match(text, /proceed=true/);
  assert.match(text, /^ios=true$/m);
  assert.match(text, /^android=false$/m);
});
