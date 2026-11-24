// Unit tests for scripts/mobile-store-target.mjs. Run: node --test scripts/mobile-store-target.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDevDispatchAllowed,
  assertVersionAhead,
  certifyStoreBuildSha,
  pickBuildSha,
  resolveStoreTarget,
} from './mobile-store-target.mjs';

const SHA = 'a'.repeat(40);
const GREEN = 'b'.repeat(40);
const PARENT = 'c'.repeat(40);
const TIP = 'd'.repeat(40);

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

test('certifyStoreBuildSha needs the commit\'s own green dev push run; a former [skip ci] bump never inherits', async () => {
  const api = async (path) => {
    if (path.includes(`head_sha=${GREEN}`)) return { workflow_runs: [{ head_sha: GREEN, head_branch: 'dev' }] };
    if (path.includes(`head_sha=${SHA}`)) return { workflow_runs: [{ head_sha: SHA, head_branch: 'feat/x' }] };
    if (path.includes(`head_sha=${TIP}`)) return { workflow_runs: [] };
    throw new Error(`unexpected ${path}`);
  };
  assert.deepEqual(await certifyStoreBuildSha(api, 'o/r', GREEN), { sha: GREEN, branch: 'dev' });
  await assert.rejects(certifyStoreBuildSha(api, 'o/r', SHA), /no successful CI push run on dev/);
  await assert.rejects(certifyStoreBuildSha(api, 'o/r', TIP), /no successful CI push run on dev/);
});

test('resolveStoreTarget builds a certified tip on dispatch without INPUT_REF, without walking back', async () => {
  const api = async (path) => {
    if (path.includes(`head_sha=${TIP}`)) return { workflow_runs: [{ head_sha: TIP, head_branch: 'dev' }] };
    if (path.includes('/commits?') || path.includes('branch=dev')) throw new Error(`should not walk back: ${path}`);
    throw new Error(`unexpected ${path}`);
  };
  const target = await resolveStoreTarget(
    { GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't', EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/dev', GITHUB_SHA: TIP, INPUT_REF: '' },
    api,
  );
  assert.deepEqual(target, { sha: TIP, branch: 'dev', resolvedFromGreenWalk: false });
});

// Version at release time (#2613): manual dispatch never uploads an already-released version.
test('assertVersionAhead: ahead passes; not ahead and API failure refuse (fail-safe)', async () => {
  const b64 = (v) => Buffer.from(`${v}\n`).toString('base64');
  const api = (version, tags) => async (path) => {
    if (path.includes('/contents/app/VERSION')) return { content: b64(version) };
    if (path.includes('/matching-refs/tags/v')) {
      if (tags instanceof Error) throw tags;
      return tags.map((t) => ({ ref: `refs/tags/${t}` }));
    }
    throw new Error(`unexpected ${path}`);
  };
  assert.equal((await assertVersionAhead(api('1.9.291', ['v1.9.290']), 'o/r', GREEN)).ahead, true);
  await assert.rejects(assertVersionAhead(api('1.9.290', ['v1.9.290']), 'o/r', GREEN), /not ahead of the released v1\.9\.290.*Not uploading/);
  await assert.rejects(assertVersionAhead(api('1.9.291', new Error('HTTP 502')), 'o/r', GREEN), /could not read the release tags/);
});
