#!/usr/bin/env node
// Post-deploy smoke for a KC environment (dev or prod), run by the deploy
// pipeline after the web deploy and again after a rollback, and by the CI
// release lane (version check only) before the dev E2E.
//
// Checks (all run; the summary lists every failure, not just the first):
//   version    /version.json reports the expected commit. Polled with backoff
//              until SMOKE_TIMEOUT_SECONDS: right after a deploy the edge may
//              still serve the previous build, or index.html (SPA fallback)
//              before version.json exists.
//   web        `/` returns HTML and every script it references returns 200.
//   pages      every static public page in app/apps/mobile/public (privacy,
//              terms, support, delete-account, child-safety — the URLs the
//              stores link to) is served as itself, at both /<name> and
//              /<name>.html, and not as the SPA fallback (index.html), which
//              renders the Expo Router "Unmatched Route" screen. Catches a
//              deploy that is missing a page the store listings depend on.
//   applinks   /.well-known/apple-app-site-association and assetlinks.json answer
//              200 directly (no redirect: Apple and Google do not follow one),
//              as application/json, with the same JSON as the checkout.
//   sharedlinks  a link-preview crawler asking for /post/<id> and /user/<handle> is answered with
//              an Open Graph card (the Pages function is deployed and boots), while a desktop
//              browser still gets the SPA (FR-POST-023).
//   supabase   Auth health (/auth/v1/health) answers 200 with the anon key.
//   functions  every Edge Function with a probe in scripts/edge-functions.mjs
//              (SMOKE_PROBES) answers one OPTIONS request with exactly the
//              status its handler's first check returns — proof it is deployed
//              and boots, without side effects. Functions with a `null` probe
//              are not called (the deploy checks them ACTIVE).
//
// Every request has a timeout, so a hanging endpoint fails instead of
// stalling the job.
// Env: SMOKE_WEB_URL, SMOKE_SHA (empty = skip the SHA match, used after a
// rollback with no earlier release tag), SMOKE_CHECKS (comma list, default
// all), SMOKE_TIMEOUT_SECONDS (default 600), SUPABASE_URL, SUPABASE_ANON_KEY.

import assert from 'node:assert/strict';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SMOKE_PROBES, listDeployableFunctions } from './edge-functions.mjs';

export const ALL_CHECKS = ['version', 'web', 'pages', 'applinks', 'sharedlinks', 'supabase', 'functions'];
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'apps', 'mobile', 'public');
const FIRST_DELAY_MS = 5_000;
const MAX_DELAY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

/** fetch with a per-request timeout (AbortSignal.timeout). */
function request(fetch, url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

/** Absolute URLs of every <script src> in `html`, resolved against `base`. */
export function extractScriptSrcs(html, base) {
  return [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => new URL(m[1], base).href);
}

/** Parse a version.json body; null when it is not the expected JSON shape. */
export function parseVersion(body) {
  try {
    const json = JSON.parse(body);
    return typeof json?.sha === 'string' ? json : null;
  } catch {
    return null;
  }
}

/**
 * Poll `${webUrl}/version.json` until it reports `sha` (any well-formed file
 * when `sha` is empty). Delays double from 5 s up to 30 s; gives up after
 * `timeoutMs`. The query string defeats any cache between us and the origin.
 */
export async function waitForVersion({ webUrl, sha, timeoutMs, fetch, sleep, now }) {
  const deadline = now() + timeoutMs;
  let delay = FIRST_DELAY_MS;
  let last = 'no response';
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await request(fetch, `${webUrl}/version.json?smoke=${now()}`, { cache: 'no-store' });
      const found = res.ok ? parseVersion(await res.text()) : null;
      if (found && (!sha || found.sha === sha)) return { ok: true, detail: `v${found.version} @ ${found.sha} (attempt ${attempt})` };
      last = found ? `serving ${found.sha}` : `HTTP ${res.status}, no version.json yet`;
    } catch (err) {
      last = err.message;
    }
    if (now() + delay > deadline) return { ok: false, detail: `expected ${sha || 'a version.json'}; last: ${last}` };
    await sleep(delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }
}

/** `/` must be HTML whose scripts (the JS bundle) all load. */
export async function checkWeb({ webUrl, fetch }) {
  const res = await request(fetch, `${webUrl}/`, { cache: 'no-store' });
  const html = await res.text();
  if (!res.ok || !/<html/i.test(html)) return { ok: false, detail: `GET / → HTTP ${res.status}, not an HTML page` };
  const scripts = extractScriptSrcs(html, `${webUrl}/`);
  if (scripts.length === 0) return { ok: false, detail: 'index.html references no script bundle' };
  const broken = [];
  for (const src of scripts) {
    const r = await request(fetch, src);
    if (r.status !== 200) broken.push(`${src} → HTTP ${r.status}`);
  }
  return broken.length ? { ok: false, detail: broken.join('; ') } : { ok: true, detail: `${scripts.length} scripts load` };
}

/** Decoded text of the first <title> in `html`, or '' when there is none. */
export function extractTitle(html) {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  if (!m) return '';
  return m[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * The static public pages shipped in app/apps/mobile/public: every *.html
 * except index.html (the SPA shell template), with the <title> each must be
 * served with. Read from the checkout, which is the deployed commit.
 */
export function listPublicPages(dir = PUBLIC_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.html') && f !== 'index.html')
    .sort()
    .map((f) => ({ name: f.slice(0, -'.html'.length), title: extractTitle(readFileSync(join(dir, f), 'utf8')) }));
}

/**
 * Each public page must answer 200 with its own <title> at /<name> and at
 * /<name>.html (Cloudflare Pages may redirect the latter to the former). A
 * missing page falls through to the SPA shell, which still answers 200, so the
 * title is the signal, not the status.
 */
export async function checkPages({ webUrl, fetch, pages = listPublicPages() }) {
  if (pages.length === 0) return { ok: false, detail: 'no public pages found to check' };
  const bad = [];
  for (const { name, title } of pages) {
    if (!title) {
      bad.push(`${name}.html has no <title> in the checkout`);
      continue;
    }
    for (const path of [`/${name}`, `/${name}.html`]) {
      const res = await request(fetch, `${webUrl}${path}`, { cache: 'no-store' });
      const got = res.ok ? extractTitle(await res.text()) : '';
      if (!res.ok) bad.push(`${path} → HTTP ${res.status}`);
      else if (got !== title) bad.push(`${path} served "${got || 'no title'}" (SPA fallback?), expected "${title}"`);
    }
  }
  return bad.length ? { ok: false, detail: bad.join('; ') } : { ok: true, detail: `${pages.length} pages × 2 URLs serve their own page` };
}

const WELL_KNOWN = ['apple-app-site-association', 'assetlinks.json'];

/**
 * Universal/app-link manifests as served: Apple and Google fetch them without
 * following redirects and require JSON, and the body must be the deployed
 * commit's file (a stale or placeholder manifest silently breaks app links).
 */
export async function checkAppLinks({ webUrl, fetch, readSource = (name) => readFileSync(join(PUBLIC_DIR, '.well-known', name), 'utf8') }) {
  const bad = [];
  for (const name of WELL_KNOWN) {
    const url = `${webUrl}/.well-known/${name}`;
    const res = await request(fetch, url, { redirect: 'manual', cache: 'no-store' });
    if (res.status !== 200) {
      bad.push(`${name} → HTTP ${res.status}${res.status >= 300 && res.status < 400 ? ' (redirect; must be served directly)' : ''}`);
      continue;
    }
    const type = res.headers?.get?.('content-type') ?? '';
    if (!/^application\/json\b/i.test(type)) bad.push(`${name} content-type is "${type || 'missing'}", expected application/json`);
    try {
      assert.deepEqual(JSON.parse(await res.text()), JSON.parse(readSource(name)));
    } catch {
      bad.push(`${name} body differs from the checkout (or is not JSON)`);
    }
  }
  return bad.length ? { ok: false, detail: bad.join('; ') } : { ok: true, detail: `${WELL_KNOWN.length} manifests: 200, application/json, no redirect, match the checkout` };
}

const CRAWLER_UA = 'WhatsApp/2.23.20.0';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
/** A well-formed id nobody owns: the function must still answer a crawler with the generic card. */
const SHARED_LINK_PATHS = ['/post/00000000-0000-4000-8000-000000000000', '/user/kc-smoke'];

/**
 * Shared links (FR-POST-023): the Pages function answers a preview crawler with an Open Graph
 * card and leaves every other visitor on the SPA. A deploy that dropped the function would hand
 * crawlers the plain SPA shell, i.e. a WhatsApp preview with no title or image.
 */
export async function checkSharedLinks({ webUrl, fetch }) {
  const bad = [];
  for (const path of SHARED_LINK_PATHS) {
    const asCrawler = await request(fetch, `${webUrl}${path}`, { redirect: 'manual', headers: { 'user-agent': CRAWLER_UA } });
    const card = asCrawler.status === 200 ? await asCrawler.text() : '';
    if (asCrawler.status !== 200) bad.push(`${path} as a crawler → HTTP ${asCrawler.status}`);
    else if (!/property="og:title"/.test(card) || !/property="og:image"/.test(card)) bad.push(`${path} as a crawler has no Open Graph card`);
    const asBrowser = await request(fetch, `${webUrl}${path}`, { redirect: 'manual', headers: { 'user-agent': BROWSER_UA } });
    const page = asBrowser.status === 200 ? await asBrowser.text() : '';
    if (asBrowser.status !== 200) bad.push(`${path} as a browser → HTTP ${asBrowser.status}`);
    else if (/property="og:title"/.test(page)) bad.push(`${path} as a browser is served the crawler card instead of the app`);
  }
  return bad.length ? { ok: false, detail: bad.join('; ') } : { ok: true, detail: `${SHARED_LINK_PATHS.length} links: crawler gets the card, browser gets the app` };
}

/** Supabase Auth health with the public anon key: proves URL, key and project are live. */
export async function checkSupabase({ supabaseUrl, anonKey, fetch }) {
  const res = await request(fetch, `${supabaseUrl}/auth/v1/health`, { headers: { apikey: anonKey } });
  return res.status === 200 ? { ok: true, detail: 'auth health 200' } : { ok: false, detail: `auth health → HTTP ${res.status}` };
}

/**
 * One OPTIONS request per probed function (anon key + web origin); only the
 * statuses its probe lists pass. `probes` maps name → probe, null (not probed)
 * or undefined (no probe declared, which fails).
 */
export async function checkFunctions({ supabaseUrl, webUrl, anonKey, probes, fetch }) {
  const names = Object.keys(probes);
  if (names.length === 0) return { ok: false, detail: 'no functions to check' };
  const bad = [];
  const skipped = [];
  for (const name of names) {
    const probe = probes[name];
    if (probe === null) {
      skipped.push(name);
      continue;
    }
    if (!probe) {
      bad.push(`${name} has no probe in scripts/edge-functions.mjs`);
      continue;
    }
    const res = await request(fetch, `${supabaseUrl}/functions/v1/${name}`, {
      method: 'OPTIONS',
      headers: { Origin: webUrl, 'Access-Control-Request-Method': 'POST', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (!probe.expect.includes(res.status)) bad.push(`${name} → HTTP ${res.status} (expected ${probe.expect.join('/')}: ${probe.why})`);
  }
  const note = skipped.length ? `; not probed: ${skipped.join(', ')}` : '';
  return bad.length ? { ok: false, detail: bad.join('; ') + note } : { ok: true, detail: `${names.length - skipped.length} functions answer${note}` };
}

/** Run the selected checks; a thrown error becomes that check's failure. */
export async function runSmoke(opts) {
  const runners = {
    version: () => waitForVersion(opts),
    web: () => checkWeb(opts),
    pages: () => checkPages(opts),
    applinks: () => checkAppLinks(opts),
    sharedlinks: () => checkSharedLinks(opts),
    supabase: () => checkSupabase(opts),
    functions: () => checkFunctions(opts),
  };
  const results = [];
  for (const check of opts.checks) {
    try {
      results.push({ check, ...(await runners[check]()) });
    } catch (err) {
      results.push({ check, ok: false, detail: err.message });
    }
  }
  return results;
}

/** Markdown summary table. */
export function renderSummary(results, target) {
  const rows = results.map((r) => `| ${r.check} | ${r.ok ? 'pass' : 'FAIL'} | ${r.detail.replaceAll('|', '/')} |`);
  return [`### Deploy smoke — ${target}`, '', '| Check | Result | Detail |', '| --- | --- | --- |', ...rows].join('\n');
}

/** Validated options from the environment (throws on a bad configuration). */
export function optionsFromEnv(env) {
  const checks = (env.SMOKE_CHECKS || ALL_CHECKS.join(',')).split(',').map((c) => c.trim());
  const unknown = checks.filter((c) => !ALL_CHECKS.includes(c));
  if (unknown.length) throw new Error(`unknown SMOKE_CHECKS: ${unknown.join(', ')}`);
  const need = (name) => {
    if (!env[name]) throw new Error(`${name} is required for checks ${checks.join(',')}`);
    return env[name].replace(/\/$/, '');
  };
  const needsSupabase = checks.some((c) => c === 'supabase' || c === 'functions');
  return {
    checks,
    webUrl: need('SMOKE_WEB_URL'),
    sha: env.SMOKE_SHA ?? '',
    timeoutMs: Number(env.SMOKE_TIMEOUT_SECONDS || 600) * 1000,
    supabaseUrl: needsSupabase ? need('SUPABASE_URL') : '',
    anonKey: needsSupabase ? need('SUPABASE_ANON_KEY') : '',
    probes: Object.fromEntries(listDeployableFunctions().map((n) => [n, SMOKE_PROBES[n]])),
  };
}

async function main() {
  const opts = optionsFromEnv(process.env);
  const results = await runSmoke({
    ...opts,
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
  });
  const summary = renderSummary(results, opts.webUrl);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  const failed = results.filter((r) => !r.ok);
  for (const f of failed) console.log(`::error title=smoke ${f.check} failed::${f.detail}`);
  if (failed.length) process.exit(1);
  console.log('Deploy smoke passed.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.log(`::error::${err.message}`);
    process.exit(1);
  });
}
