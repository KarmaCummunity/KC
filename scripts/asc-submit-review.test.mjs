import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowed, client, execute, plan } from './asc-submit-review.mjs';

const A = 'https://api.appstoreconnect.apple.com/v1';
const build = (n, s = 'VALID') => ({ id: `b${n}`, attributes: { version: String(n), processingState: s } });
const ver = (id, vs, st) => ({ id, attributes: { versionString: vs, appVersionState: st } });
const sub = (id, st) => ({ id, attributes: { state: st } });

test('only the listed ASC write calls are allowed', () => {
  assertAllowed('GET', `${A}/apps/1/appStoreVersions`);
  assertAllowed('PATCH', `${A}/reviewSubmissions/abc`);
  assertAllowed('POST', `${A}/reviewSubmissionItems`);
  assert.throws(() => assertAllowed('DELETE', `${A}/appStoreVersions/x`));
  assert.throws(() => assertAllowed('POST', `${A}/betaGroups/x/relationships/builds`));
  assert.throws(() => assertAllowed('PATCH', `${A}/apps/1`));
  assert.throws(() => assertAllowed('GET', 'https://example.com/v1/apps'));
});

test('plan mode never sends a write', async () => {
  const api = client({ jwt: 'j', write: false, fetchImpl: async () => { throw new Error('no network'); } });
  await assert.rejects(() => api.patch('/reviewSubmissions/x', {}), /plan mode/);
});

test('a missing or unprocessed build blocks', () => {
  assert.match(plan({ builds: [], versions: [], subs: [] }, { version: '1.9.287', buildNumber: 38 }).blockers[0], /not found/);
  assert.match(plan({ builds: [build(38, 'PROCESSING')], versions: [], subs: [] }, { version: '1.9.287', buildNumber: 38 }).blockers[0], /PROCESSING/);
});

test('a waiting review of the old build is cancelled and its version reused', () => {
  const { steps, blockers } = plan({ builds: [build(38)], versions: [ver('v1', '1.9.176', 'WAITING_FOR_REVIEW')], subs: [sub('s1', 'WAITING_FOR_REVIEW')] }, { version: '1.9.287', buildNumber: 38 });
  assert.deepEqual(blockers, []);
  assert.deepEqual(steps.map((s) => s.kind), ['cancelSubmission', 'updateVersion', 'reviewNotes', 'createSubmission', 'submit']);
  assert.equal(steps[1].id, 'v1');
});

test('a rejected version is updated and its unresolved submission resubmitted', () => {
  const { steps } = plan({ builds: [build(38)], versions: [ver('v1', '1.9.176', 'REJECTED')], subs: [sub('s1', 'UNRESOLVED_ISSUES')] }, { version: '1.9.287', buildNumber: 38 });
  assert.deepEqual(steps.map((s) => s.kind), ['updateVersion', 'reviewNotes', 'reuseSubmission', 'submit']);
});

test('with no editable version a new MANUAL version is created and submitted', async () => {
  const calls = [];
  const replies = {
    'POST /v1/appStoreVersions': { data: { id: 'v2' } },
    'GET /v1/appStoreVersions/v2/appStoreReviewDetail': { data: { id: 'r2', attributes: { demoAccountRequired: true, demoAccountName: 'x' } } },
    'PATCH /v1/appStoreReviewDetails/r2': { data: {} },
    'POST /v1/reviewSubmissions': { data: { id: 's2' } },
    'POST /v1/reviewSubmissionItems': { data: {} },
    'PATCH /v1/reviewSubmissions/s2': { data: { attributes: { state: 'WAITING_FOR_REVIEW' } } },
  };
  const fetchImpl = async (url, init) => {
    const key = `${init.method} ${new URL(url).pathname}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : null });
    const r = replies[key];
    return { ok: Boolean(r), status: r ? 200 : 404, text: async () => JSON.stringify(r ?? { errors: [{ detail: 'nope' }] }) };
  };
  const api = client({ jwt: 'j', write: true, fetchImpl });
  const state = { builds: [build(38)], versions: [ver('v0', '1.9.100', 'READY_FOR_DISTRIBUTION')], subs: [] };
  const logs = [];
  const out = await execute(api, state, { appId: '1', version: '1.9.287', buildNumber: 38, notes: 'n'.repeat(60), log: (l) => logs.push(l) });
  assert.deepEqual(out, { versionId: 'v2', submissionId: 's2' });
  assert.equal(calls[0].body.data.attributes.releaseType, 'MANUAL');
  assert.equal(calls[0].body.data.relationships.build.data.id, 'b38');
  assert.ok(calls.some((c) => c.key === 'PATCH /v1/reviewSubmissions/s2' && c.body.data.attributes.submitted === true));
  assert.ok(!logs.join('\n').includes('password'));
});
