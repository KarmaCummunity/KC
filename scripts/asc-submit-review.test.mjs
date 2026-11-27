import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowed, client, execute, plan, describeAscErrors } from './asc-submit-review.mjs';

const A = 'https://api.appstoreconnect.apple.com/v1';
const build = (n, s = 'VALID') => ({ id: `b${n}`, attributes: { version: String(n), processingState: s } });
const ver = (id, vs, st, buildNumber = null) => ({ id, buildNumber, attributes: { versionString: vs, appVersionState: st } });
const sub = (id, st, versionIds = []) => ({ id, versionIds, attributes: { state: st } });
const kinds = (r) => r.steps.map((s) => s.kind);

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
  assert.match(plan({ builds: [], versions: [], subs: [] }, { version: '1.9.288', buildNumber: 38 }).blockers[0], /not found/);
  assert.match(plan({ builds: [build(38, 'PROCESSING')], versions: [], subs: [] }, { version: '1.9.288', buildNumber: 38 }).blockers[0], /PROCESSING/);
});

test('a waiting review of the old build is cancelled only when the dispatch names that submission', () => {
  const state = { builds: [build(38)], versions: [ver('v1', '1.9.176', 'WAITING_FOR_REVIEW', '36')], subs: [sub('s1', 'WAITING_FOR_REVIEW', ['v1'])] };
  const bare = plan(state, { version: '1.9.288', buildNumber: 38 });
  assert.deepEqual(bare.blockers, []);
  assert.match(bare.needs[0], /cancel_submission=s1/);
  const named = plan(state, { version: '1.9.288', buildNumber: 38, cancelSubmission: 's1' });
  assert.deepEqual(named.needs, []);
  assert.deepEqual(kinds(named), ['cancelSubmission', 'updateVersion', 'reviewNotes', 'createSubmission', 'submit']);
  assert.equal(named.steps[0].oldBuild, '36');
  assert.equal(named.steps[1].id, 'v1');
  assert.match(plan(state, { version: '1.9.288', buildNumber: 38, cancelSubmission: 'other' }).blockers[0], /does not match/);
});

test('the requested build already waiting for review is a no-op', () => {
  const r = plan({ builds: [build(38)], versions: [ver('v1', '1.9.288', 'WAITING_FOR_REVIEW', '38')], subs: [sub('s1', 'WAITING_FOR_REVIEW', ['v1'])] }, { version: '1.9.288', buildNumber: 38, cancelSubmission: 's1' });
  assert.deepEqual(r.steps, []);
  assert.match(r.done, /already WAITING_FOR_REVIEW/);
});

test('an unrelated second version in flight blocks instead of being renamed', () => {
  const r = plan({ builds: [build(38)], versions: [ver('v2', '2.0.0', 'PREPARE_FOR_SUBMISSION'), ver('v1', '1.9.288', 'WAITING_FOR_REVIEW', '36')], subs: [sub('s1', 'WAITING_FOR_REVIEW', ['v1'])] }, { version: '1.9.288', buildNumber: 38, cancelSubmission: 's1' });
  assert.match(r.blockers.join(' '), /more than one version in flight/);
});

test('a submission holding another version is never touched', () => {
  const r = plan({ builds: [build(38)], versions: [ver('v1', '1.9.176', 'PREPARE_FOR_SUBMISSION')], subs: [sub('s9', 'WAITING_FOR_REVIEW', ['vX'])] }, { version: '1.9.288', buildNumber: 38 });
  assert.match(r.blockers.join(' '), /s9 .*another version/);
  assert.ok(!r.steps.some((s) => s.kind === 'cancelSubmission'));
});

test('an approved version waiting for release blocks', () => {
  const r = plan({ builds: [build(38)], versions: [ver('v1', '1.9.176', 'PENDING_DEVELOPER_RELEASE', '36')], subs: [] }, { version: '1.9.288', buildNumber: 38 });
  assert.match(r.blockers.join(' '), /neither editable nor waiting/);
});

test('a rejected version is updated and its unresolved submission resubmitted', () => {
  const r = plan({ builds: [build(38)], versions: [ver('v1', '1.9.176', 'REJECTED', '36')], subs: [sub('s1', 'UNRESOLVED_ISSUES', ['v1'])] }, { version: '1.9.288', buildNumber: 38 });
  assert.deepEqual(r.blockers, []);
  assert.deepEqual(kinds(r), ['updateVersion', 'reviewNotes', 'reuseSubmission', 'submit']);
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
  const out = await execute(api, state, { appId: '1', version: '1.9.288', buildNumber: 38, notes: 'n'.repeat(60), log: (l) => logs.push(l) });
  assert.deepEqual(out, { versionId: 'v2', submissionId: 's2' });
  assert.equal(calls[0].body.data.attributes.releaseType, 'MANUAL');
  assert.equal(calls[0].body.data.relationships.build.data.id, 'b38');
  assert.ok(calls.some((c) => c.key === 'PATCH /v1/reviewSubmissions/s2' && c.body.data.attributes.submitted === true));
  assert.ok(!logs.join('\n').includes('password'));
});

test('describeAscErrors surfaces associated errors behind a 409', () => {
  const body = { errors: [{ code: 'STATE_ERROR.ENTITY_STATE_INVALID', detail: 'This resource cannot be reviewed, please check associated errors to see why.',
    meta: { associatedErrors: { '/v1/appStoreVersions/1c45': [{ code: 'ENTITY_ERROR.ATTRIBUTE.REQUIRED', detail: 'You must provide a value for the attribute whatsNew' }],
      '/v1/appScreenshotSets/x': [{ code: 'ENTITY_ERROR', detail: 'x'.repeat(500) }] } } }] };
  const out = describeAscErrors(body);
  assert.match(out, /^STATE_ERROR\.ENTITY_STATE_INVALID This resource cannot be reviewed/);
  assert.match(out, /associated \/appStoreVersions\/1c45: ENTITY_ERROR\.ATTRIBUTE\.REQUIRED You must provide a value for the attribute whatsNew/);
  for (const part of out.split('; ')) assert.ok(part.length <= 300);
  assert.equal(describeAscErrors({}), '');
});
