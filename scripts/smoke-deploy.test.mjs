// Unit tests for scripts/smoke-deploy.mjs. Run: node --test scripts/smoke-deploy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAppLinks,
  checkSharedLinks,
  checkFunctions,
  checkPages,
  extractTitle,
  listPublicPages,
  checkSupabase,
  checkWeb,
  extractScriptSrcs,
  optionsFromEnv,
  renderSummary,
  runSmoke,
  waitForVersion,
} from './smoke-deploy.mjs';

const SHA = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const WEB = 'https://dev.example.dev';
const SB = 'https://ref.supabase.co';
const INDEX = '<!DOCTYPE html><html><body><script src="/_expo/static/js/web/entry-1.js" defer></script></body></html>';

const response = (status, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body });

/** Fake fetch: `routes` maps "METHOD url-prefix" to a response or a list served in order. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    calls.push(key);
    const hit = Object.keys(routes).find((k) => key.startsWith(k));
    if (!hit) throw new Error(`unexpected ${key}`);
    const r = routes[hit];
    return Array.isArray(r) ? (r.length > 1 ? r.shift() : r[0]) : r;
  };
  return { fetch, calls };
}

/** Virtual clock: sleep advances time instantly. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

test('extractScriptSrcs resolves every script src against the page URL', () => {
  assert.deepEqual(extractScriptSrcs(INDEX, `${WEB}/`), [`${WEB}/_expo/static/js/web/entry-1.js`]);
  assert.deepEqual(extractScriptSrcs('<html></html>', `${WEB}/`), []);
});

test('waitForVersion keeps polling through the SPA fallback and an old build', async () => {
  const { fetch } = fakeFetch({
    [`GET ${WEB}/version.json`]: [response(200, INDEX), response(200, JSON.stringify({ sha: OLD })), response(200, JSON.stringify({ version: '1.5.3', sha: SHA }))],
  });
  const result = await waitForVersion({ webUrl: WEB, sha: SHA, timeoutMs: 60_000, fetch, ...clock() });
  assert.equal(result.ok, true);
  assert.match(result.detail, /v1\.5\.3 @ a{40} \(attempt 3\)/);
});

test('waitForVersion fails after the timeout and reports what was served', async () => {
  const { fetch, calls } = fakeFetch({ [`GET ${WEB}/version.json`]: response(200, JSON.stringify({ sha: OLD })) });
  const result = await waitForVersion({ webUrl: WEB, sha: SHA, timeoutMs: 60_000, fetch, ...clock() });
  assert.equal(result.ok, false);
  assert.match(result.detail, new RegExp(`expected ${SHA}; last: serving ${OLD}`));
  // 5 + 10 + 20 + 30 s of backoff fit in 60 s; the next 30 s wait would not.
  assert.equal(calls.length, 4);
});

test('waitForVersion without an expected SHA accepts any well-formed version.json', async () => {
  const { fetch } = fakeFetch({ [`GET ${WEB}/version.json`]: response(200, JSON.stringify({ version: '1.5.2', sha: OLD })) });
  assert.equal((await waitForVersion({ webUrl: WEB, sha: '', timeoutMs: 1000, fetch, ...clock() })).ok, true);
});

test('checkWeb requires HTML and a loadable bundle', async () => {
  const ok = fakeFetch({ [`GET ${WEB}/_expo`]: response(200), [`GET ${WEB}/`]: response(200, INDEX) });
  assert.deepEqual(await checkWeb({ webUrl: WEB, fetch: ok.fetch }), { ok: true, detail: '1 scripts load' });
  const missing = fakeFetch({ [`GET ${WEB}/_expo`]: response(404), [`GET ${WEB}/`]: response(200, INDEX) });
  assert.match((await checkWeb({ webUrl: WEB, fetch: missing.fetch })).detail, /entry-1\.js → HTTP 404/);
  const noScripts = fakeFetch({ [`GET ${WEB}/`]: response(200, '<html></html>') });
  assert.match((await checkWeb({ webUrl: WEB, fetch: noScripts.fetch })).detail, /no script bundle/);
});

test('checkSupabase needs a 200 from auth health', async () => {
  assert.equal((await checkSupabase({ supabaseUrl: SB, anonKey: 'k', fetch: fakeFetch({ [`GET ${SB}/auth`]: response(200) }).fetch })).ok, true);
  assert.equal((await checkSupabase({ supabaseUrl: SB, anonKey: 'k', fetch: fakeFetch({ [`GET ${SB}/auth`]: response(401) }).fetch })).ok, false);
});

test('checkFunctions accepts only each probe\'s expected status and skips unprobed functions', async () => {
  const { fetch, calls } = fakeFetch({
    [`OPTIONS ${SB}/functions/v1/preflight`]: response(200),
    [`OPTIONS ${SB}/functions/v1/guarded`]: response(405),
    [`OPTIONS ${SB}/functions/v1/crash`]: response(503),
    [`OPTIONS ${SB}/functions/v1/gone`]: response(404),
  });
  const probes = {
    preflight: { expect: [200], why: 'preflight' },
    guarded: { expect: [405], why: 'method guard' },
    crash: { expect: [405], why: 'method guard' },
    gone: { expect: [405], why: 'method guard' },
    charger: null,
    undeclared: undefined,
  };
  const result = await checkFunctions({ supabaseUrl: SB, webUrl: WEB, anonKey: 'k', probes, fetch });
  assert.equal(result.ok, false);
  assert.match(result.detail, /^crash → HTTP 503 \(expected 405: method guard\); gone → HTTP 404/);
  assert.match(result.detail, /undeclared has no probe/);
  assert.match(result.detail, /not probed: charger$/);
  assert.ok(!calls.some((c) => c.includes('charger')), 'an unprobed function is never called');
});

test('checkFunctions passes when every probe matches', async () => {
  const { fetch } = fakeFetch({ [`OPTIONS ${SB}/functions/v1/a`]: response(401) });
  const probes = { a: { expect: [401], why: 'x' }, b: null };
  const result = await checkFunctions({ supabaseUrl: SB, webUrl: WEB, anonKey: 'k', probes, fetch });
  assert.deepEqual(result, { ok: true, detail: '1 functions answer; not probed: b' });
});

test('every request carries a timeout signal', async () => {
  const signals = [];
  const fetch = async (url, init) => {
    signals.push(init.signal);
    return response(200);
  };
  await checkSupabase({ supabaseUrl: SB, anonKey: 'k', fetch });
  assert.ok(signals[0] instanceof AbortSignal);
});

test('runSmoke runs every selected check and turns a throw into a failure', async () => {
  const { fetch } = fakeFetch({ [`GET ${SB}/auth`]: response(200) });
  const results = await runSmoke({ checks: ['supabase', 'web'], webUrl: WEB, supabaseUrl: SB, anonKey: 'k', fetch, ...clock() });
  assert.deepEqual(results.map((r) => [r.check, r.ok]), [['supabase', true], ['web', false]]);
  assert.match(results[1].detail, /unexpected GET/);
  assert.match(renderSummary(results, WEB), /\| web \| FAIL \|/);
});

test('optionsFromEnv validates the check list and required settings', () => {
  const opts = optionsFromEnv({ SMOKE_CHECKS: 'version', SMOKE_WEB_URL: `${WEB}/`, SMOKE_SHA: SHA, SMOKE_TIMEOUT_SECONDS: '30' });
  assert.deepEqual([opts.webUrl, opts.timeoutMs, opts.supabaseUrl], [WEB, 30_000, '']);
  assert.throws(() => optionsFromEnv({ SMOKE_CHECKS: 'versoin', SMOKE_WEB_URL: WEB }), /unknown SMOKE_CHECKS: versoin/);
  assert.throws(() => optionsFromEnv({ SMOKE_WEB_URL: WEB }), /SUPABASE_URL is required/);
  const all = optionsFromEnv({ SMOKE_WEB_URL: WEB, SUPABASE_URL: SB, SUPABASE_ANON_KEY: 'k' });
  assert.ok(Object.keys(all.probes).length > 0);
});

const SHELL = '<!DOCTYPE html><html><head><title>KC - קהילת קארמה</title></head><body><div id="root"></div></body></html>';
const page = (title) => `<!doctype html><html><head><title>${title}</title></head><body>static</body></html>`;

test('extractTitle decodes entities and tolerates a missing title', () => {
  assert.equal(extractTitle(page('Support &amp; Help')), 'Support & Help');
  assert.equal(extractTitle('<html></html>'), '');
});

test('listPublicPages covers the store-linked pages and skips the SPA shell', () => {
  const pages = listPublicPages();
  const names = pages.map((p) => p.name);
  for (const required of ['privacy', 'terms', 'support', 'delete-account', 'child-safety']) assert.ok(names.includes(required), required);
  assert.ok(!names.includes('index'));
  for (const p of pages) assert.ok(p.title.length > 0, `${p.name} has a title`);
});

test('checkPages passes when every page serves its own title at both URLs', async () => {
  const { fetch, calls } = fakeFetch({
    [`GET ${WEB}/delete-account`]: response(200, page('Delete your account')),
    [`GET ${WEB}/privacy`]: response(200, page('Privacy')),
  });
  const pages = [{ name: 'delete-account', title: 'Delete your account' }, { name: 'privacy', title: 'Privacy' }];
  const result = await checkPages({ webUrl: WEB, fetch, pages });
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(calls, [`GET ${WEB}/delete-account`, `GET ${WEB}/delete-account.html`, `GET ${WEB}/privacy`, `GET ${WEB}/privacy.html`]);
});

test('checkPages fails when a page falls through to the SPA shell (Unmatched Route)', async () => {
  const { fetch } = fakeFetch({
    [`GET ${WEB}/child-safety`]: response(200, SHELL),
    [`GET ${WEB}/privacy`]: response(200, page('Privacy')),
  });
  const pages = [{ name: 'child-safety', title: 'Child Safety' }, { name: 'privacy', title: 'Privacy' }];
  const result = await checkPages({ webUrl: WEB, fetch, pages });
  assert.equal(result.ok, false);
  assert.match(result.detail, /\/child-safety served "KC - קהילת קארמה" \(SPA fallback\?\)/);
  assert.match(result.detail, /\/child-safety\.html served/);
  assert.doesNotMatch(result.detail, /privacy/);
});

test('checkPages reports HTTP errors and a page without a title', async () => {
  const { fetch } = fakeFetch({ [`GET ${WEB}/terms`]: response(404) });
  const result = await checkPages({ webUrl: WEB, fetch, pages: [{ name: 'terms', title: 'Terms' }, { name: 'blank', title: '' }] });
  assert.equal(result.ok, false);
  assert.match(result.detail, /\/terms → HTTP 404/);
  assert.match(result.detail, /blank\.html has no <title>/);
});

const manifest = (status, body, type = 'application/json') => ({
  ...response(status, body),
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
});
const WK = { 'apple-app-site-association': '{"applinks":{}}', 'assetlinks.json': '[]' };
const readSource = (name) => WK[name];

test('checkAppLinks passes for direct 200 JSON that matches the checkout', async () => {
  const { fetch, calls } = fakeFetch({
    [`GET ${WEB}/.well-known/apple-app-site-association`]: manifest(200, '{ "applinks": {} }'),
    [`GET ${WEB}/.well-known/assetlinks.json`]: manifest(200, '[]'),
  });
  const result = await checkAppLinks({ webUrl: WEB, fetch, readSource });
  assert.equal(result.ok, true, result.detail);
  assert.equal(calls.length, 2);
});

test('checkAppLinks fails on a redirect, a wrong content type and a stale body', async () => {
  const { fetch } = fakeFetch({
    [`GET ${WEB}/.well-known/apple-app-site-association`]: manifest(301, ''),
    [`GET ${WEB}/.well-known/assetlinks.json`]: manifest(200, '[{"old":1}]', 'application/octet-stream'),
  });
  const result = await checkAppLinks({ webUrl: WEB, fetch, readSource });
  assert.equal(result.ok, false);
  assert.match(result.detail, /apple-app-site-association → HTTP 301 \(redirect/);
  assert.match(result.detail, /assetlinks\.json content-type is "application\/octet-stream"/);
  assert.match(result.detail, /assetlinks\.json body differs/);
});

const OG_CARD = '<meta property="og:title" content="x" /><meta property="og:image" content="y" />';
/** Answers by User-Agent like the Pages function: a crawler gets the card, a browser the SPA. */
const sharedLinksFetch = (card, spa) => async (_url, init = {}) =>
  /WhatsApp/.test(init.headers['user-agent']) ? card : spa;

test('checkSharedLinks passes when crawlers get the card and browsers get the app', async () => {
  const result = await checkSharedLinks({ webUrl: WEB, fetch: sharedLinksFetch(response(200, OG_CARD), response(200, '<html>SPA</html>')) });
  assert.equal(result.ok, true, result.detail);
});

test('checkSharedLinks fails when the function is missing (crawler gets the SPA shell)', async () => {
  const result = await checkSharedLinks({ webUrl: WEB, fetch: sharedLinksFetch(response(200, '<html>SPA</html>'), response(200, '<html>SPA</html>')) });
  assert.equal(result.ok, false);
  assert.match(result.detail, /\/post\/.* as a crawler has no Open Graph card/);
});

test('checkSharedLinks fails when a browser is served the crawler card or an error', async () => {
  const leaked = await checkSharedLinks({ webUrl: WEB, fetch: sharedLinksFetch(response(200, OG_CARD), response(200, OG_CARD)) });
  assert.match(leaked.detail, /as a browser is served the crawler card/);
  const broken = await checkSharedLinks({ webUrl: WEB, fetch: sharedLinksFetch(response(200, OG_CARD), response(500)) });
  assert.match(broken.detail, /as a browser → HTTP 500/);
});
