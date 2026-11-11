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
