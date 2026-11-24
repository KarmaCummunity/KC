// Unit tests for scripts/store-version.mjs (#2613). Run: node --test scripts/store-version.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPatch, openVersionPr, tagNames, versionGate, versionPrBody, versionPrDecision } from './store-version.mjs';

const TAGS = ['v1.9.289', 'v1.9.290', 'v1.10.0-rc', 'mobile/ios/v1.9.295-b43'];

test('ahead: app/VERSION above the latest v* tag builds', () => {
  const g = versionGate({ version: '1.9.291\n', tags: TAGS });
  assert.equal(g.ahead, true);
  assert.equal(g.latest, 'v1.9.290');
  assert.equal(g.next, null);
  assert.equal(versionGate({ version: '1.0.0', tags: [] }).ahead, true, 'no release yet = ahead');
});

test('not ahead: equal to (or below) the latest tag skips and names the next patch', () => {
  const eq = versionGate({ version: '1.9.290', tags: TAGS });
  assert.equal(eq.ahead, false);
  assert.equal(eq.next, '1.9.291');
  assert.match(eq.reason, /not ahead of the released v1\.9\.290; skipping tonight's store build/);
  const below = versionGate({ version: '1.9.100', tags: TAGS });
  assert.equal(below.ahead, false);
  assert.equal(below.next, '1.9.291', 'next patch above max(VERSION, tag)');
});

test('API failure is fail-safe: unreadable tags or a malformed VERSION skip, never upload', () => {
  const g = versionGate({ version: '1.9.999', tags: null });
  assert.equal(g.ahead, false);
  assert.equal(g.next, null);
  assert.match(g.reason, /could not read the release tags; skipping/);
  assert.equal(versionGate({ version: 'junk', tags: TAGS }).ahead, false);
});

test('tagNames strips refs/tags/ and nextPatch rejects junk', () => {
  assert.deepEqual(tagNames([{ ref: 'refs/tags/v1.2.3' }, {}]), ['v1.2.3']);
  assert.equal(nextPatch('1.9.290'), '1.9.291');
  assert.throws(() => nextPatch('1.9'), /MAJOR.MINOR.PATCH/);
});

test('version PR already open (ours or the release train\'s) or opened today → no new PR', () => {
  const todayBranch = 'store-version/2026-11-24';
  assert.equal(versionPrDecision({ openPrs: [{ number: 7, head: { ref: 'store-version/2026-11-23' } }], todayBranch, todayBranchExists: false }).open, false);
  assert.equal(versionPrDecision({ openPrs: [{ number: 8, head: { ref: 'release-train/v1.9.291-1' } }], todayBranch, todayBranchExists: false }).open, false);
  assert.match(versionPrDecision({ openPrs: [], todayBranch, todayBranchExists: true }).reason, /one version PR per day/);
  assert.equal(versionPrDecision({ openPrs: [{ number: 9, head: { ref: 'feat/x' } }], todayBranch, todayBranchExists: false }).open, true);
});

function fakeGh(state) {
  const calls = [];
  const gh = async (method, path, body, opts = {}) => {
    calls.push([method, path, body]);
    if (method === 'GET' && path.includes('/pulls?')) return state.openPrs;
    if (method === 'GET' && path.includes('/git/ref/heads/store-version/')) return state.branchExists ? { object: { sha: 'x' } } : (opts.allow404 ? null : assert.fail('404'));
    if (method === 'GET' && path.endsWith('/git/ref/heads/dev')) return { object: { sha: 'd'.repeat(40) } };
    if (method === 'GET' && path.includes('/contents/app/VERSION')) return { sha: 'blob' };
    if (method === 'POST' && path.endsWith('/pulls')) return { number: 42, node_id: 'N42', html_url: 'https://github.com/o/r/pull/42' };
    return {};
  };
  const gqlCalls = [];
  const gql = async (q, v) => { gqlCalls.push([q, v]); return {}; };
  return { gh, gql, calls, gqlCalls };
}

test('openVersionPr creates the branch at the dev tip, sets VERSION, labels it and arms auto-merge', async () => {
  const f = fakeGh({ openPrs: [], branchExists: false });
  const r = await openVersionPr({ ...f, repo: 'o/r', base: 'dev', version: '1.9.291', latest: 'v1.9.290', now: '2026-11-24T00:43:00Z', log: () => {} });
  assert.deepEqual(r, { opened: true, number: 42, url: 'https://github.com/o/r/pull/42' });
  const post = (suffix) => f.calls.find(([m, p]) => m !== 'GET' && p.endsWith(suffix));
  assert.deepEqual(post('/git/refs')[2], { ref: 'refs/heads/store-version/2026-11-24', sha: 'd'.repeat(40) });
  const put = post('/contents/app/VERSION')[2];
  assert.equal(Buffer.from(put.content, 'base64').toString(), '1.9.291\n');
  assert.equal(put.branch, 'store-version/2026-11-24');
  assert.equal(post('/pulls')[2].base, 'dev');
  assert.deepEqual(post('/issues/42/labels')[2], { labels: ['area:ci', 'agent:kc-bot'] });
  assert.match(f.gqlCalls[0][0], /enablePullRequestAutoMerge/);
  assert.deepEqual(f.gqlCalls[0][1], { id: 'N42' });
});

test('openVersionPr writes nothing when a version PR is already open', async () => {
  const f = fakeGh({ openPrs: [{ number: 7, head: { ref: 'store-version/2026-11-23' } }], branchExists: false });
  const r = await openVersionPr({ ...f, repo: 'o/r', base: 'dev', version: '1.9.291', latest: 'v1.9.290', now: '2026-11-24T00:43:00Z', log: () => {} });
  assert.equal(r.opened, false);
  assert.equal(f.calls.filter(([m]) => m !== 'GET').length, 0);
  assert.equal(f.gqlCalls.length, 0);
});

test('the PR body carries the hygiene sections and the CLA box', () => {
  const body = versionPrBody({ version: '1.9.291', latest: 'v1.9.290', runUrl: 'https://x/run/1' });
  for (const s of ['Opened by: agent:kc-bot', '## Summary', '## Changes', '## Mapped to spec', '## Refactor logged', '## SSOT updated', '- [x] I have read and agree to the [Contributor License Agreement](../CLA.md).']) {
    assert.ok(body.includes(s), s);
  }
});
