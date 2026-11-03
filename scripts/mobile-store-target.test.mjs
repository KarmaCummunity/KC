// Unit tests for scripts/mobile-store-target.mjs. Run: node --test scripts/mobile-store-target.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDevDispatchAllowed,
  pickBuildSha,
  resolveStoreTarget,
} from './mobile-store-target.mjs';

const SHA = 'a'.repeat(40);
const GREEN = 'b'.repeat(40);

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
