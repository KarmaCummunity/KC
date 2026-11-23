// Run: node --test scripts/store-status.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  assertStoreRequestAllowed,
  createGuardedFetch,
  fetchAscStatus,
  fetchPlayStatus,
  stateFingerprint,
  shouldComment,
  parseFingerprintFromComments,
  formatSummaryMarkdown,
  ASC_API,
  PLAY_API,
  PLAY_PACKAGE,
} from './store-status.mjs';

test('ASC allowlist accepts GET and rejects writes', () => {
  assert.doesNotThrow(() => assertStoreRequestAllowed('GET', `${ASC_API}/apps/1/builds`));
  assert.throws(() => assertStoreRequestAllowed('POST', `${ASC_API}/apps/1/builds`), /ASC allowlist/);
  assert.throws(() => assertStoreRequestAllowed('PATCH', `${ASC_API}/betaBuildLocalizations/1`), /ASC allowlist/);
});

test('Play allowlist accepts create-edit, list tracks, delete edit only', () => {
  const pkg = PLAY_PACKAGE;
  const edits = `${PLAY_API}/applications/${pkg}/edits`;
  assert.doesNotThrow(() => assertStoreRequestAllowed('POST', edits));
  assert.doesNotThrow(() => assertStoreRequestAllowed('GET', `${edits}/edit-1/tracks`));
  assert.doesNotThrow(() => assertStoreRequestAllowed('DELETE', `${edits}/edit-1`));
  assert.throws(() => assertStoreRequestAllowed('POST', `${edits}/edit-1:commit`), /Play allowlist/);
  assert.throws(() => assertStoreRequestAllowed('PUT', `${edits}/edit-1/tracks/internal`), /Play allowlist/);
  assert.throws(() => assertStoreRequestAllowed('GET', `${PLAY_API}/applications/${pkg}/reviews`), /Play allowlist/);
});

test('guarded fetch records only allowlisted ASC GETs (injected, no network)', async () => {
  const calls = [];
  const fake = async (url, init = {}) => {
    calls.push({ method: (init.method || 'GET').toUpperCase(), url: String(url) });
    const path = new URL(url).pathname;
    if (path.endsWith('/reviewSubmissions')) {
      return jsonRes({ data: [{ id: '4f86322a', attributes: { state: 'WAITING_FOR_REVIEW', submittedDate: '2026-11-19T00:00:00Z' } }] });
    }
    if (path.endsWith('/appStoreVersions')) {
      return jsonRes({
        data: [{
          id: 'v1',
          attributes: { versionString: '1.0.0', appStoreState: 'WAITING_FOR_REVIEW' },
          relationships: { build: { data: { type: 'builds', id: 'b1' } } },
        }],
        included: [{ id: 'b1', type: 'builds', attributes: { version: '36' } }],
      });
    }
    if (path.endsWith('/builds')) {
      return jsonRes({ data: [{ id: 'b1', attributes: { version: '36', processingState: 'VALID', uploadedDate: '2026-11-18T00:00:00Z' } }] });
    }
    throw new Error(`unexpected ${path}`);
  };
  const status = await fetchAscStatus({ appId: '123', jwt: 'fake.jwt', fetchImpl: fake });
  assert.equal(status.reviewSubmissions[0].id, '4f86322a');
  assert.equal(status.appStoreVersions[0].buildNumber, '36');
  assert.equal(status.builds[0].processingState, 'VALID');
  const buildsCall = calls.find((c) => new URL(c.url).pathname.endsWith('/builds'));
  const q = new URL(buildsCall.url).searchParams;
  assert.equal(q.get('sort'), '-uploadedDate');
  assert.equal(q.get('filter[app]'), '123');
  assert.ok(calls.length >= 3);
  for (const c of calls) {
    assert.equal(c.method, 'GET');
    assert.match(c.url, /^https:\/\/api\.appstoreconnect\.apple\.com\//);
    assertStoreRequestAllowed(c.method, c.url);
  }
});

test('Play status uses POST edits, GET tracks, DELETE edit — never commit', async () => {
  const calls = [];
  const fake = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ method, url: String(url) });
    const path = new URL(url).pathname;
    if (method === 'POST' && /\/edits\/?$/.test(path)) return jsonRes({ id: 'edit-99' });
    if (method === 'GET' && path.endsWith('/tracks')) {
      return jsonRes({
        tracks: [
          { track: 'production', releases: [] },
          { track: 'alpha', releases: [{ name: '1.7.228', versionCodes: ['8'], status: 'completed' }] },
          { track: 'internal', releases: [{ name: '1.9.176', versionCodes: ['18'], status: 'completed' }] },
        ],
      });
    }
    if (method === 'DELETE' && /\/edits\/edit-99\/?$/.test(path)) return { ok: true, status: 204, json: async () => ({}) };
    throw new Error(`unexpected ${method} ${path}`);
  };
  const status = await fetchPlayStatus({ accessToken: 'token', fetchImpl: fake });
  assert.equal(status.tracks.find((t) => t.track === 'alpha').releases[0].versionCodes[0], '8');
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET', 'DELETE']);
  for (const c of calls) assertStoreRequestAllowed(c.method, c.url);
  assert.equal(calls.some((c) => c.url.includes(':commit')), false);
});

test('Play deletes the edit even when listing tracks fails', async () => {
  const calls = [];
  const fake = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ method, url: String(url) });
    const path = new URL(url).pathname;
    if (method === 'POST' && /\/edits\/?$/.test(path)) return jsonRes({ id: 'edit-fail' });
    if (method === 'GET' && path.endsWith('/tracks')) {
      return { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) };
    }
    if (method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) };
    throw new Error(`unexpected ${method} ${path}`);
  };
  await assert.rejects(() => fetchPlayStatus({ accessToken: 'token', fetchImpl: fake }), /boom|HTTP 500/);
  assert.equal(calls.at(-1).method, 'DELETE');
  assert.match(calls.at(-1).url, /\/edits\/edit-fail\/?$/);
});

test('createGuardedFetch blocks disallowed methods before calling through', async () => {
  let hit = false;
  const guarded = createGuardedFetch(async () => { hit = true; return jsonRes({}); });
  await assert.rejects(
    () => guarded(`${PLAY_API}/applications/${PLAY_PACKAGE}/edits/x:commit`, { method: 'POST' }),
    /Play allowlist/,
  );
  assert.equal(hit, false);
});

test('fingerprint + comment gating', () => {
  const a = {
    asc: { reviewSubmissions: [{ id: '1', state: 'WAITING_FOR_REVIEW' }], appStoreVersions: [], builds: [] },
    play: { tracks: [{ track: 'internal', releases: [{ name: '1.9.176', versionCodes: ['18'], status: 'completed' }] }] },
  };
  const b = structuredClone(a);
  b.asc.reviewSubmissions[0].state = 'REJECTED';
  const fa = stateFingerprint(a);
  const fb = stateFingerprint(b);
  assert.notEqual(fa, fb);
  assert.equal(shouldComment(fa, fa), false);
  assert.equal(shouldComment(fa, fb), true);
  assert.equal(shouldComment(null, fa), true);
  assert.equal(
    parseFingerprintFromComments([{ body: `<!-- store-status-fp:${fa} -->\nok` }]),
    fa,
  );
});

test('summary markdown includes ASC and Play rows', () => {
  const md = formatSummaryMarkdown({
    fingerprint: 'a'.repeat(64),
    asc: {
      reviewSubmissions: [{ id: '4f86322a', state: 'WAITING_FOR_REVIEW', submittedDate: '2026-11-19' }],
      appStoreVersions: [{ versionString: '1.0.0', appStoreState: 'WAITING_FOR_REVIEW', buildNumber: '36' }],
      builds: [{ version: '36', processingState: 'VALID' }],
    },
    play: {
      tracks: [{ track: 'internal', releases: [{ name: '1.9.176', versionCodes: ['18'], status: 'completed' }] }],
    },
  });
  assert.match(md, /4f86322a/);
  assert.match(md, /internal/);
  assert.match(md, /1\.9\.176/);
});

test('createAscJwt produces three ES256 segments without network', async () => {
  const { createAscJwt } = await import('./store-status.mjs');
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jwt = createAscJwt({ keyId: 'KEY', issuerId: 'ISS', privateKeyPem: pem });
  assert.equal(jwt.split('.').length, 3);
});

function jsonRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
