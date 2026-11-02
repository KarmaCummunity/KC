#!/usr/bin/env node
// After a TestFlight upload: wait for the build to become VALID, add it to the
// external beta groups and submit it for Beta App Review. Never prints secrets.
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, ASC_APP_ID, BUILD_NUMBER,
//      TF_GROUPS (comma list), TF_WHATS_NEW, TF_TIMEOUT_MIN (default 45)
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

export const FORBIDDEN_GROUPS = ['KupaPay testers'];
const API = 'https://api.appstoreconnect.apple.com/v1/';

export function parseGroups(list) {
  const names = String(list || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of names) if (FORBIDDEN_GROUPS.includes(n)) throw new Error(`group not allowed: ${n}`);
  return names;
}

export function whatsNewText(raw) {
  const t = String(raw || '').trim();
  return (t || 'General testing of Karma Community').slice(0, 3900);
}

function b64u(b) { return Buffer.from(b).toString('base64url'); }
function token({ keyId, issuer, key }) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: issuer, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }));
  const s = createSign('SHA256').update(`${h}.${p}`).sign({ key, dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${b64u(s)}`;
}

async function main() {
  const env = process.env;
  const creds = { keyId: env.ASC_KEY_ID, issuer: env.ASC_ISSUER_ID, key: readFileSync(env.ASC_KEY_PATH, 'utf8') };
  const app = env.ASC_APP_ID, num = String(env.BUILD_NUMBER || '');
  const groups = parseGroups(env.TF_GROUPS);
  const timeoutMs = Number(env.TF_TIMEOUT_MIN || 45) * 60000;
  const call = async (method, path, body) => {
    const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token(creds)}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    return { status: r.status, j, errs: (j.errors || []).map((e) => `${e.code}: ${e.detail}`) };
  };
  if (!app || !num) throw new Error('ASC_APP_ID and BUILD_NUMBER are required');

  let build; const t0 = Date.now();
  for (;;) {
    const { j } = await call('GET', `builds?filter[app]=${app}&filter[version]=${encodeURIComponent(num)}&limit=1`);
    build = j.data?.[0];
    const st = build?.attributes?.processingState;
    console.log(`build ${num}: ${st || 'not visible yet'}`);
    if (st === 'VALID') break;
    if (st === 'FAILED' || st === 'INVALID') throw new Error(`build ${num} processing ${st}`);
    if (Date.now() - t0 > timeoutMs) { console.log(`::warning::build ${num} not VALID after ${timeoutMs / 60000} min; not distributed. Upload itself succeeded.`); return; }
    await new Promise((r) => setTimeout(r, 60000));
  }
  const bid = build.id;

  const { j: gj } = await call('GET', `apps/${app}/betaGroups?limit=50`);
  for (const name of groups) {
    const g = (gj.data || []).find((x) => x.attributes.name === name && !x.attributes.isInternalGroup);
    if (!g) { console.log(`::warning::external group "${name}" not found`); continue; }
    const r = await call('POST', `betaGroups/${g.id}/relationships/builds`, { data: [{ type: 'builds', id: bid }] });
    console.log(`add to "${name}": ${r.status} ${r.errs.join('; ')}`);
  }

  const text = whatsNewText(env.TF_WHATS_NEW);
  const { j: lj } = await call('GET', `builds/${bid}/betaBuildLocalizations`);
  const locs = lj.data || [];
  if (!locs.length) {
    const r = await call('POST', 'betaBuildLocalizations', { data: { type: 'betaBuildLocalizations', attributes: { locale: 'en-US', whatsNew: text }, relationships: { build: { data: { type: 'builds', id: bid } } } } });
    console.log(`what to test (en-US): ${r.status} ${r.errs.join('; ')}`);
  }
  for (const l of locs) {
    const r = await call('PATCH', `betaBuildLocalizations/${l.id}`, { data: { type: 'betaBuildLocalizations', id: l.id, attributes: { whatsNew: text } } });
    console.log(`what to test (${l.attributes.locale}): ${r.status} ${r.errs.join('; ')}`);
  }

  const ex = await call('GET', `builds/${bid}/betaAppReviewSubmission`);
  if (ex.j.data) console.log(`beta review: already ${ex.j.data.attributes.betaReviewState}`);
  else {
    const r = await call('POST', 'betaAppReviewSubmissions', { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: bid } } } } });
    console.log(`beta review submit: ${r.status} ${r.j.data?.attributes?.betaReviewState || ''} ${r.errs.join('; ')}`);
  }
  const d = await call('GET', `builds/${bid}/buildBetaDetail`);
  console.log(`external state: ${d.j.data?.attributes?.externalBuildState}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.log(`::warning::TestFlight distribution failed: ${e.message}`); process.exitCode = 0; });
}
