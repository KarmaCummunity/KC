/**
 * Read-only ASC + Play HTTP helpers for store-status (#2608).
 * ASC: GET only. Play: POST create-edit, GET tracks, DELETE edit (never commit).
 */
import { createSign, createHash } from 'node:crypto';

export const ASC_API = 'https://api.appstoreconnect.apple.com/v1';
export const PLAY_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
export const PLAY_PACKAGE = 'org.karmacommunity.app';
export const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
export const FP_MARKER_RE = /<!-- store-status-fp:([a-f0-9]{64}) -->/;

const ASC_HOST = 'api.appstoreconnect.apple.com';
const PLAY_HOST = 'androidpublisher.googleapis.com';

/** Allowlist: ASC GET only; Play POST create-edit, GET tracks, DELETE edit. */
export function assertStoreRequestAllowed(method, url) {
  const u = new URL(url);
  const m = String(method || 'GET').toUpperCase();
  if (u.hostname === ASC_HOST) {
    if (m !== 'GET') throw new Error(`ASC allowlist: GET only, got ${m} ${u.pathname}`);
    return;
  }
  if (u.hostname === PLAY_HOST) {
    const path = u.pathname;
    const createEdit = m === 'POST' && /\/applications\/[^/]+\/edits\/?$/.test(path);
    const listTracks = m === 'GET' && /\/edits\/[^/]+\/tracks\/?$/.test(path);
    const deleteEdit = m === 'DELETE' && /\/edits\/[^/]+\/?$/.test(path) && !path.includes('/tracks');
    if (createEdit || listTracks || deleteEdit) return;
    throw new Error(`Play allowlist rejected: ${m} ${path}`);
  }
  throw new Error(`store allowlist: unexpected host ${u.hostname}`);
}

/** Wrap fetch so every ASC/Play call is checked before the network. */
export function createGuardedFetch(fetchImpl = fetch) {
  return async (url, init = {}) => {
    assertStoreRequestAllowed(init.method || 'GET', url);
    return fetchImpl(url, init);
  };
}

function b64u(buf) {
  return Buffer.from(buf).toString('base64url');
}

/** App Store Connect JWT (ES256). Never log the return value. */
export function createAscJwt({ keyId, issuerId, privateKeyPem }) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: issuerId, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }));
  const sig = createSign('SHA256').update(`${h}.${p}`).sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${b64u(sig)}`;
}

async function jsonGet(fetchImpl, url, headers) {
  const res = await fetchImpl(url, { method: 'GET', headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.error?.message || body?.errors?.[0]?.detail || `HTTP ${res.status}`;
    throw new Error(`GET ${new URL(url).pathname}: ${detail}`);
  }
  return body;
}

/** Latest ASC review submissions, versions (with build #), and builds. GET only. */
export async function fetchAscStatus({ appId, jwt, fetchImpl }) {
  const guarded = createGuardedFetch(fetchImpl);
  const headers = { Authorization: `Bearer ${jwt}`, Accept: 'application/json' };
  const base = `${ASC_API}/apps/${encodeURIComponent(appId)}`;
  const [subs, versions, builds] = await Promise.all([
    jsonGet(guarded, `${base}/reviewSubmissions?limit=5`, headers),
    jsonGet(guarded, `${base}/appStoreVersions?limit=10&include=build&fields[appStoreVersions]=versionString,appStoreState&fields[builds]=version`, headers),
    jsonGet(guarded, `${base}/builds?limit=10&fields[builds]=version,processingState,uploadedDate`, headers),
  ]);
  const included = new Map((versions.included || []).map((r) => [r.id, r]));
  return {
    reviewSubmissions: (subs.data || []).map((r) => ({
      id: r.id,
      state: r.attributes?.state ?? null,
      submittedDate: r.attributes?.submittedDate ?? null,
    })),
    appStoreVersions: (versions.data || []).map((r) => {
      const buildRel = r.relationships?.build?.data;
      const build = buildRel ? included.get(buildRel.id) : null;
      return {
        versionString: r.attributes?.versionString ?? null,
        appStoreState: r.attributes?.appStoreState ?? null,
        buildNumber: build?.attributes?.version ?? null,
      };
    }),
    builds: (builds.data || []).map((r) => ({
      version: r.attributes?.version ?? null,
      processingState: r.attributes?.processingState ?? null,
      uploadedDate: r.attributes?.uploadedDate ?? null,
    })),
  };
}

/** Exchange service-account JSON for a Play access token (not under store allowlist). */
export async function fetchPlayAccessToken(sa, fetchImpl = fetch) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({
    iss: sa.client_email,
    scope: PLAY_SCOPE,
    aud: OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const assertion = `${h}.${p}.${b64u(createSign('RSA-SHA256').update(`${h}.${p}`).sign(sa.private_key))}`;
  const res = await fetchImpl(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Play OAuth token exchange failed (HTTP ${res.status})`);
  }
  return body.access_token;
}

/**
 * Play tracks via a disposable edit: POST create → GET tracks → DELETE (never commit).
 */
export async function fetchPlayStatus({
  packageName = PLAY_PACKAGE,
  accessToken,
  fetchImpl,
}) {
  const guarded = createGuardedFetch(fetchImpl);
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
  const editsUrl = `${PLAY_API}/applications/${encodeURIComponent(packageName)}/edits`;
  const createRes = await guarded(editsUrl, { method: 'POST', headers, body: '{}' });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !created.id) {
    throw new Error(`Play create edit failed (HTTP ${createRes.status})`);
  }
  const editId = created.id;
  try {
    const tracksBody = await jsonGet(guarded, `${editsUrl}/${encodeURIComponent(editId)}/tracks`, headers);
    return {
      packageName,
      tracks: (tracksBody.tracks || []).map((t) => {
        const releases = (t.releases || []).map((rel) => ({
          name: rel.name ?? null,
          versionCodes: (rel.versionCodes || []).map(String),
          status: rel.status ?? null,
        }));
        return { track: t.track, releases };
      }),
    };
  } finally {
    // Always abort the edit so nothing is left open or committed.
    const del = await guarded(`${editsUrl}/${encodeURIComponent(editId)}`, { method: 'DELETE', headers });
    if (!del.ok && del.status !== 404) {
      throw new Error(`Play delete edit failed (HTTP ${del.status})`);
    }
  }
}

/** Stable fingerprint of store state (excludes wall-clock-only fields). */
export function stateFingerprint(report) {
  const slim = {
    asc: {
      reviewSubmissions: (report.asc?.reviewSubmissions || []).map(({ id, state }) => ({ id, state })),
      appStoreVersions: report.asc?.appStoreVersions || [],
      builds: (report.asc?.builds || []).map(({ version, processingState }) => ({ version, processingState })),
    },
    play: report.play || null,
  };
  return createHash('sha256').update(JSON.stringify(slim)).digest('hex');
}

export function formatSummaryMarkdown(report) {
  const lines = ['## Store status', '', `Fingerprint: \`${report.fingerprint.slice(0, 12)}…\``, ''];
  lines.push('### App Store Connect', '', '| Kind | Detail |', '| --- | --- |');
  for (const s of report.asc?.reviewSubmissions || []) {
    lines.push(`| reviewSubmission | \`${s.id}\` · ${s.state} · ${s.submittedDate || '—'} |`);
  }
  for (const v of report.asc?.appStoreVersions || []) {
    lines.push(`| appStoreVersion | ${v.versionString} · ${v.appStoreState} · build ${v.buildNumber ?? '—'} |`);
  }
  for (const b of report.asc?.builds || []) {
    lines.push(`| build | ${b.version} · ${b.processingState} |`);
  }
  if (!report.asc) lines.push('| — | ASC skipped or failed |');
  lines.push('', '### Google Play', '', '| Track | Releases |', '| --- | --- |');
  for (const t of report.play?.tracks || []) {
    const rel = (t.releases || [])
      .map((r) => `${r.name || '(unnamed)'} vc ${r.versionCodes.join(',')} (${r.status})`)
      .join('; ') || '(empty)';
    lines.push(`| ${t.track} | ${rel} |`);
  }
  if (!report.play) lines.push('| — | Play skipped or failed |');
  lines.push('');
  return lines.join('\n');
}

export function shouldComment(previousFingerprint, nextFingerprint) {
  return Boolean(nextFingerprint) && previousFingerprint !== nextFingerprint;
}

export function parseFingerprintFromComments(comments) {
  for (const c of comments || []) {
    const m = String(c.body || '').match(FP_MARKER_RE);
    if (m) return m[1];
  }
  return null;
}
