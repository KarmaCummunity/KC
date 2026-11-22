import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enforceSilentTesters } from './testflight-distribute.mjs';

const detail = (autoNotifyEnabled = true, id = 'detail-1') => ({
  status: 200, j: { data: { type: 'buildBetaDetails', id, attributes: { autoNotifyEnabled } } },
});
function mock(responses) {
  const calls = [];
  return { calls, call: async (...args) => { calls.push(args); return responses.shift(); } };
}
test('disables automatic announcements on the exact build before continuing', async () => {
  const m = mock([detail(), detail(false), detail(false)]);
  assert.equal(await enforceSilentTesters(m.call, 'build-1'), 'detail-1');
  assert.deepEqual(m.calls, [
    ['GET', 'builds/build-1/buildBetaDetail'],
    ['PATCH', 'buildBetaDetails/detail-1', { data: { type: 'buildBetaDetails', id: 'detail-1', attributes: { autoNotifyEnabled: false } } }],
    ['GET', 'builds/build-1/buildBetaDetail'],
  ]);
});
test('reruns explicitly preserve false, not Apple defaults', async () => {
  const m = mock([detail(false), detail(false), detail(false)]);
  await enforceSilentTesters(m.call, 'build-1');
  assert.equal(m.calls[1][2].data.attributes.autoNotifyEnabled, false);
});
for (const [label, response] of [
  ['404', { status: 404, j: {} }],
  ['no resource', { status: 200, j: {} }],
  ['wrong type', { status: 200, j: { data: { type: 'builds', id: 'x' } } }],
]) test(`invalid initial detail ${label} stops before any write`, async () => {
  const m = mock([response]);
  await assert.rejects(enforceSilentTesters(m.call, 'build-1'));
  assert.equal(m.calls.length, 1);
});
test('PATCH failure stops before distribution', async () => {
  const m = mock([detail(), { status: 403, j: {} }]);
  await assert.rejects(enforceSilentTesters(m.call, 'build-1'));
  assert.equal(m.calls.length, 2);
});
for (const [label, response] of [
  ['still true', detail(true)], ['missing flag', { status: 200, j: { data: { type: 'buildBetaDetails', id: 'detail-1', attributes: {} } } }],
  ['changed id', detail(false, 'other')], ['unavailable', { status: 503, j: {} }],
  ['wrong type', { status: 200, j: { data: { type: 'builds', id: 'detail-1', attributes: { autoNotifyEnabled: false } } } }],
]) test(`readback ${label} fails closed`, async () => {
  const m = mock([detail(), detail(false), response]);
  await assert.rejects(enforceSilentTesters(m.call, 'build-1'));
});
test('network failure propagates rather than proceeding', async () => {
  await assert.rejects(enforceSilentTesters(async () => { throw new Error('offline'); }, 'build-1'));
});
test('all existing external release paths preserve audience and DEV-only policy', () => {
  const workflow = readFileSync(new URL('../.github/workflows/testflight-ios.yml', import.meta.url), 'utf8');
  const script = readFileSync(new URL('./testflight-distribute.mjs', import.meta.url), 'utf8');
  const step = workflow.slice(workflow.indexOf('- name: Prepare external beta review'), workflow.indexOf('- name: Remove key files'));
  assert.match(step, /STORE_BACKEND != 'prod'/);
  assert.match(step, /TF_GROUPS: KC Beta,KC Real Users/);
  assert.doesNotMatch(step, /continue-on-error/);
  assert.ok(script.indexOf('await enforceSilentTesters(call, bid)') < script.indexOf("const { j: gj }"));
  assert.doesNotMatch(script, /buildBetaNotifications|betaTesterInvitations/);
  assert.match(script, /process.exitCode = 1/);
});
