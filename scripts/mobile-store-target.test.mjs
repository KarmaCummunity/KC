// Unit tests for scripts/mobile-store-target.mjs. Run: node --test scripts/mobile-store-target.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUMP_IDENTITY,
  BUMP_SUBJECT,
} from './deploy-target.mjs';
import {
  assertDevDispatchAllowed,
  certifyStoreBuildSha,
  pickBuildSha,
  resolveStoreTarget,
} from './mobile-store-target.mjs';

const SHA = 'a'.repeat(40);
const GREEN = 'b'.repeat(40);
const PARENT = 'c'.repeat(40);
const BUMP = 'd'.repeat(40);
const bot = { ...BUMP_IDENTITY, date: '2026-10-31T00:00:00Z' };

const bumpPayload = (overrides = {}) => ({
  sha: BUMP,
  parents: [{ sha: PARENT }],
  files: [{ filename: 'app/VERSION' }],
  commit: {
    author: bot,
    committer: bot,
    message: `${BUMP_SUBJECT} to 1.7.214 [skip ci]`,
    ...overrides.commit,
  },
  ...overrides,
});

test('assertDevDispatchAllowed rejects non-dev manual runs', () => {
  assert.throws(
    () => assertDevDispatchAllowed('workflow_dispatch', 'refs/heads/main'),
    /only on dev/,
  );
  assert.doesNotThrow(() => assertDevDispatchAllowed('workflow_dispatch', 'refs/heads/dev'));
  assert.doesNotThrow(() => assertDevDispatchAllowed('workflow_call', 'refs/heads/main'));
});

test('pickBuildSha uses input ref for workflow_call and explicit dispatch', () => {
  assert.equal(pickBuildSha({ eventName: 'workflow_call', inputRef: SHA, resolvedGreenSha: null }), SHA);
  assert.equal(pickBuildSha({ eventName: 'workflow_dispatch', inputRef: SHA, resolvedGreenSha: GREEN }), SHA);
});

test('pickBuildSha uses resolved green SHA when dispatch has no input', () => {
  assert.equal(
    pickBuildSha({ eventName: 'workflow_dispatch', inputRef: null, resolvedGreenSha: GREEN }),
    GREEN,
  );
});

test('resolveStoreTarget walks back on dispatch without INPUT_REF', async () => {
  const api = async (path) => {
    if (path.includes('/commits?')) return [{ sha: 'tip' }, { sha: GREEN }];
    if (path.includes('branch=dev') && path.includes('workflows/ci.yml')) {
      return { workflow_runs: [{ head_sha: GREEN }] };
    }
    if (path.includes(`head_sha=${GREEN}`)) {
      return { workflow_runs: [{ head_sha: GREEN, head_branch: 'dev' }] };
    }
    throw new Error(`unexpected ${path}`);
  };
  const env = {
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_TOKEN: 't',
    EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/dev',
    INPUT_REF: '',
    LOOKBACK: '30',
  };
  const target = await resolveStoreTarget(env, api);
  assert.equal(target.sha, GREEN);
  assert.equal(target.branch, 'dev');
  assert.equal(target.resolvedFromGreenWalk, true);
});

test('resolveStoreTarget validates explicit INPUT_REF on dispatch', async () => {
  const api = async (path) => {
    if (path.includes(`head_sha=${SHA}`)) {
      return { workflow_runs: [{ head_sha: SHA, head_branch: 'dev' }] };
    }
    throw new Error(`unexpected ${path}`);
  };
  const target = await resolveStoreTarget(
    {
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_TOKEN: 't',
      EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/dev',
      INPUT_REF: SHA,
    },
    api,
  );
  assert.equal(target.sha, SHA);
  assert.equal(target.resolvedFromGreenWalk, false);
});

test('resolveStoreTarget refuses a commit with no green CI', async () => {
  const api = async (path) => {
    if (path.includes(`head_sha=${SHA}`)) return { workflow_runs: [] };
    if (path.includes(`/commits/${SHA}`)) {
      return {
        sha: SHA,
        parents: [{ sha: PARENT }],
        files: [{ filename: 'app/foo.ts' }],
        commit: { author: { name: 'x', email: 'y@z.com' }, committer: { name: 'x', email: 'y@z.com' }, message: 'feat: x' },
      };
    }
    throw new Error(`unexpected ${path}`);
  };
  await assert.rejects(
    () =>
      resolveStoreTarget(
        {
          GITHUB_REPOSITORY: 'o/r',
          GITHUB_TOKEN: 't',
          EVENT_NAME: 'workflow_call',
          GITHUB_REF: 'refs/heads/dev',
          INPUT_REF: SHA,
        },
        api,
      ),
    /no successful CI push run/,
  );
});

test('certifyStoreBuildSha accepts a version-only bump with a green parent CI gate on dev', async () => {
  const jobs = { 99: [{ name: 'CI gate', conclusion: 'success' }] };
  const api = async (path) => {
    if (path.includes(`head_sha=${BUMP}`)) return { workflow_runs: [] };
    if (path.includes(`head_sha=${PARENT}`)) {
      return { workflow_runs: [{ id: 99, event: 'push', conclusion: 'success', head_branch: 'dev' }] };
    }
    if (path.includes(`/commits/${BUMP}`)) return bumpPayload();
    throw new Error(`unexpected ${path}`);
  };
  const jobsOf = async (id) => jobs[id];
  const r = await certifyStoreBuildSha(api, 'o/r', BUMP, { jobsOf });
  assert.deepEqual(r, { sha: BUMP, branch: 'dev', inheritedFrom: PARENT });
});

test('certifyStoreBuildSha refuses a bump whose parent has no green CI gate', async () => {
  const api = async (path) => {
    if (path.includes(`head_sha=${BUMP}`)) return { workflow_runs: [] };
    if (path.includes(`head_sha=${PARENT}`)) return { workflow_runs: [] };
    if (path.includes(`/commits/${BUMP}`)) return bumpPayload();
    throw new Error(`unexpected ${path}`);
  };
  await assert.rejects(
    () => certifyStoreBuildSha(api, 'o/r', BUMP, { jobsOf: async () => [] }),
    /parent.*no green/,
  );
});

test('certifyStoreBuildSha refuses a malformed bump shape', async () => {
  const api = async (path) => {
    if (path.includes(`head_sha=${BUMP}`)) return { workflow_runs: [] };
    if (path.includes(`/commits/${BUMP}`)) {
      return bumpPayload({ files: [{ filename: 'app/VERSION' }, { filename: 'app/x.ts' }] });
    }
    throw new Error(`unexpected ${path}`);
  };
  await assert.rejects(() => certifyStoreBuildSha(api, 'o/r', BUMP, { jobsOf: async () => [] }), /refusing to build/);
});

test('resolveStoreTarget builds an explicit bump SHA on inherited parent certification', async () => {
  const jobs = { 99: [{ name: 'CI gate', conclusion: 'success' }] };
  const api = async (path) => {
    if (path.includes(`head_sha=${BUMP}`)) return { workflow_runs: [] };
    if (path.includes(`head_sha=${PARENT}`)) {
      return { workflow_runs: [{ id: 99, event: 'push', conclusion: 'success', head_branch: 'dev' }] };
    }
    if (path.includes('/actions/runs/99/jobs')) return { jobs: jobs[99] };
    if (path.includes(`/commits/${BUMP}`)) return bumpPayload();
    throw new Error(`unexpected ${path}`);
  };
  const target = await resolveStoreTarget(
    {
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_TOKEN: 't',
      EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/dev',
      INPUT_REF: BUMP,
    },
    api,
  );
  assert.equal(target.sha, BUMP);
  assert.equal(target.branch, 'dev');
  assert.equal(target.inheritedFrom, PARENT);
});
