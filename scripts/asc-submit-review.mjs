#!/usr/bin/env node
// App Store review submission for one processed iOS build (issue #2613).
//
// Two modes, both started only by `.github/workflows/asc-submit-review.yml`
// (manual dispatch on main):
//   plan    GET only. Prints what `submit` would do.
//   submit  Does it. It attaches the VALID build to the App Store version (the
//           editable one, or a new one) with release type MANUAL, so an
//           approved version is never released by itself. It sets the review
//           notes from a file in the repo and submits the version for App Review.
//           A review submission still waiting with an older build is cancelled
//           first, only when the dispatch names that submission id
//           (cancel_submission, read from a plan run). A rejected submission (UNRESOLVED_ISSUES) is answered by
//           submitting the same submission again.
// It never touches TestFlight groups or testers, never releases a version,
// and never prints credentials or the demo account password.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ASC_API, createAscJwt } from './store-status-api.mjs';

/** Version states in which the version, its build and its review notes can still be edited. */
export const EDITABLE_STATES = new Set([
  'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY',
]);
/** Version states that mean a review is pending and has to be cancelled before another build can be submitted. */
export const WAITING_STATES = new Set(['WAITING_FOR_REVIEW', 'IN_REVIEW']);

// Only these write calls exist. Every other non-GET request is refused.
const WRITE_ALLOW = [
  ['POST', /^\/v1\/appStoreVersions$/],
  ['PATCH', /^\/v1\/appStoreVersions\/[\w-]+$/],
  ['POST', /^\/v1\/appStoreReviewDetails$/],
  ['PATCH', /^\/v1\/appStoreReviewDetails\/[\w-]+$/],
  ['POST', /^\/v1\/reviewSubmissions$/],
  ['PATCH', /^\/v1\/reviewSubmissions\/[\w-]+$/],
  ['POST', /^\/v1\/reviewSubmissionItems$/],
];

export function assertAllowed(method, url) {
  const u = new URL(url);
  if (u.origin !== new URL(ASC_API).origin) throw new Error(`refused: ${method} to ${u.origin}`);
  if (method === 'GET') return;
  if (!WRITE_ALLOW.some(([m, re]) => m === method && re.test(u.pathname))) throw new Error(`refused: ${method} ${u.pathname}`);
}

export function client({ jwt, fetchImpl = fetch, write = false }) {
  const call = async (method, path, body) => {
    const url = path.startsWith('http') ? path : `${ASC_API}${path}`;
    assertAllowed(method, url);
    if (method !== 'GET' && !write) throw new Error(`plan mode: ${method} ${new URL(url).pathname} not sent`);
    const res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const errs = (json.errors || []).map((e) => `${e.code || ''} ${e.detail || e.title || ''}`.trim()).join('; ');
      throw new Error(`${method} ${new URL(url).pathname}: HTTP ${res.status} ${errs}`);
    }
    return json;
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b) };
}

const versionState = (v) => v.attributes?.appVersionState ?? v.attributes?.appStoreState ?? null;

/** Version states after which a version is history (released or removed); every other state is in flight. */
export const DONE_STATES = new Set([
  'READY_FOR_DISTRIBUTION', 'READY_FOR_SALE', 'REMOVED_FROM_SALE', 'DEVELOPER_REMOVED_FROM_SALE', 'REPLACED_WITH_NEW_VERSION', 'NOT_APPLICABLE',
]);
const OPEN_SUB_STATES = ['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES'];

/** Read everything the decision needs. GET only. */
export async function readState(api, { appId, version, buildNumber }) {
  const q = new URLSearchParams({
    'filter[app]': appId, 'filter[version]': String(buildNumber), 'filter[preReleaseVersion.version]': version,
    'fields[builds]': 'version,processingState,uploadedDate,usesNonExemptEncryption', limit: '5',
  });
  const builds = (await api.get(`/builds?${q}`)).data || [];
  const vres = await api.get(`/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=20&include=build`);
  const included = new Map((vres.included || []).filter((x) => x.type === 'builds').map((b) => [b.id, b]));
  const versions = (vres.data || []).map((v) => {
    const bid = v.relationships?.build?.data?.id ?? null;
    return { ...v, buildId: bid, buildNumber: bid ? (included.get(bid)?.attributes?.version ?? null) : null };
  });
  const subs = [];
  for (const s of (await api.get(`/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&limit=20`)).data || []) {
    if (!OPEN_SUB_STATES.includes(s.attributes?.state)) { subs.push(s); continue; }
    const items = (await api.get(`/reviewSubmissions/${s.id}/items?include=appStoreVersion&limit=20`)).data || [];
    subs.push({ ...s, versionIds: items.map((it) => it.relationships?.appStoreVersion?.data?.id).filter(Boolean) });
  }
  return { builds, versions, subs };
}

/**
 * Decide the steps. Pure, so it is unit-tested. Returns { steps, blockers, needs, done }.
 * `needs` lists dispatch inputs `submit` requires (the exact submission to cancel).
 * Step kinds: cancelSubmission, updateVersion, createVersion, reviewNotes,
 * reuseSubmission, createSubmission, submit.
 *
 * Target-bound and fail-closed (review of #2619 on issue #2613):
 * - At most one in-flight (not released) version may exist; it is the target.
 *   Two or more, or one that is approved and waiting for release, is a blocker.
 * - The requested build already attached to a waiting version is a no-op.
 * - Only a submission whose items hold the target version is touched. Any
 *   other open submission is a blocker.
 * - Cancelling a waiting review is done only when `cancelSubmission` names
 *   that exact submission id, read from a `plan` run first.
 */
export function plan({ builds, versions, subs }, { version, buildNumber, cancelSubmission = '' }) {
  const blockers = [];
  const needs = [];
  const steps = [];
  const build = builds.find((b) => String(b.attributes?.version) === String(buildNumber));
  if (!build) blockers.push(`build ${version} (${buildNumber}) not found in App Store Connect`);
  else if (build.attributes?.processingState !== 'VALID') blockers.push(`build ${buildNumber} is ${build.attributes?.processingState}, not VALID`);

  const inFlight = versions.filter((v) => !DONE_STATES.has(versionState(v)));
  const label = (v) => `${v.attributes?.versionString} ${versionState(v)} (build ${v.buildNumber ?? 'none'})`;
  if (inFlight.length > 1) blockers.push(`more than one version in flight: ${inFlight.map(label).join(', ')}; resolve in App Store Connect first`);
  const target = inFlight.length === 1 ? inFlight[0] : null;
  const tState = target ? versionState(target) : null;
  if (target && !EDITABLE_STATES.has(tState) && !WAITING_STATES.has(tState)) {
    blockers.push(`version ${label(target)} is neither editable nor waiting for review (e.g. approved, pending release); not changing it`);
  }

  const open = subs.filter((s) => OPEN_SUB_STATES.includes(s.attributes?.state));
  const mine = open.filter((s) => target && (s.versionIds || []).includes(target.id));
  const foreign = open.filter((s) => !mine.includes(s) && (s.versionIds || []).length > 0);
  for (const s of foreign) blockers.push(`review submission ${s.id} (${s.attributes.state}) holds another version; not touching it`);
  const empty = open.filter((s) => (s.versionIds || []).length === 0);

  if (target && WAITING_STATES.has(tState) && String(target.buildNumber) === String(buildNumber)
      && target.attributes?.versionString === version) {
    return { steps: [], blockers, needs, done: `build ${buildNumber} is already ${tState} on version ${version}; nothing to do` };
  }

  if (target && WAITING_STATES.has(tState)) {
    const waitingSubs = mine.filter((s) => WAITING_STATES.has(s.attributes.state));
    if (waitingSubs.length !== 1) blockers.push(`version ${label(target)} is waiting but ${waitingSubs.length} matching review submissions were found`);
    for (const s of waitingSubs) {
      if (s.id !== cancelSubmission) needs.push(`cancel_submission=${s.id} (cancels the waiting review of ${label(target)})`);
      steps.push({ kind: 'cancelSubmission', id: s.id, state: s.attributes.state, versionId: target.id, oldBuild: target.buildNumber });
    }
  }
  if (cancelSubmission && !steps.some((s) => s.kind === 'cancelSubmission' && s.id === cancelSubmission)) {
    blockers.push(`cancel_submission=${cancelSubmission} does not match the submission this plan would cancel`);
  }

  if (target) {
    steps.push({ kind: 'updateVersion', id: target.id, from: label(target), versionString: version, buildId: build?.id ?? null });
  } else {
    steps.push({ kind: 'createVersion', versionString: version, buildId: build?.id ?? null });
  }
  steps.push({ kind: 'reviewNotes', versionId: target?.id ?? null });
  const reusable = mine.filter((s) => ['UNRESOLVED_ISSUES', 'READY_FOR_REVIEW'].includes(s.attributes.state));
  const reuse = reusable[0] ?? (empty.length === 1 && ['UNRESOLVED_ISSUES', 'READY_FOR_REVIEW'].includes(empty[0].attributes.state) ? empty[0] : null);
  if (empty.length > 1) blockers.push(`${empty.length} open review submissions have no items; resolve in App Store Connect first`);
  if (reuse) steps.push({ kind: 'reuseSubmission', id: reuse.id, state: reuse.attributes.state });
  else steps.push({ kind: 'createSubmission' });
  steps.push({ kind: 'submit' });
  return { steps, blockers, needs, done: null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitVersionEditable(api, id, tries = 30) {
  for (let i = 0; i < tries; i += 1) {
    const v = (await api.get(`/appStoreVersions/${id}`)).data;
    if (EDITABLE_STATES.has(versionState(v))) return v;
    await sleep(10_000);
  }
  throw new Error(`version ${id} did not become editable after cancelling the review submission`);
}

/** Run the plan. Logs one line per step. */
export async function execute(api, state, { appId, version, buildNumber, notes, cancelSubmission = '', log = console.log }) {
  const { steps, blockers, needs, done } = plan(state, { version, buildNumber, cancelSubmission });
  if (blockers.length) throw new Error(`not submitting: ${blockers.join('; ')}`);
  if (needs.length) throw new Error(`not submitting: needs ${needs.join('; ')}`);
  if (done) { log(done); return { versionId: null, submissionId: null, done }; }
  const build = state.builds.find((b) => String(b.attributes?.version) === String(buildNumber));
  let versionId = null;
  let submissionId = null;
  for (const step of steps) {
    if (step.kind === 'cancelSubmission') {
      await api.patch(`/reviewSubmissions/${step.id}`, { data: { type: 'reviewSubmissions', id: step.id, attributes: { canceled: true } } });
      log(`cancelled review submission ${step.id} (${step.state})`);
    } else if (step.kind === 'updateVersion') {
      await waitVersionEditable(api, step.id);
      await api.patch(`/appStoreVersions/${step.id}`, {
        data: {
          type: 'appStoreVersions', id: step.id,
          attributes: { versionString: version, releaseType: 'MANUAL' },
          relationships: { build: { data: { type: 'builds', id: build.id } } },
        },
      });
      versionId = step.id;
      log(`version ${step.id}: ${step.from} -> ${version}, build ${buildNumber}, release MANUAL`);
    } else if (step.kind === 'createVersion') {
      const res = await api.post('/appStoreVersions', {
        data: {
          type: 'appStoreVersions',
          attributes: { platform: 'IOS', versionString: version, releaseType: 'MANUAL' },
          relationships: { app: { data: { type: 'apps', id: appId } }, build: { data: { type: 'builds', id: build.id } } },
        },
      });
      versionId = res.data.id;
      log(`created version ${versionId} ${version}, build ${buildNumber}, release MANUAL`);
    } else if (step.kind === 'reviewNotes') {
      const detail = await api.get(`/appStoreVersions/${versionId}/appStoreReviewDetail`).catch(() => ({ data: null }));
      if (detail.data?.id) {
        await api.patch(`/appStoreReviewDetails/${detail.data.id}`, { data: { type: 'appStoreReviewDetails', id: detail.data.id, attributes: { notes } } });
      } else {
        await api.post('/appStoreReviewDetails', {
          data: { type: 'appStoreReviewDetails', attributes: { notes }, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } } },
        });
      }
      const a = detail.data?.attributes || {};
      log(`review notes set (${notes.length} chars); demo account required: ${a.demoAccountRequired ?? 'unknown'}, demo user set: ${Boolean(a.demoAccountName)}`);
    } else if (step.kind === 'reuseSubmission') {
      submissionId = step.id;
      const items = (await api.get(`/reviewSubmissions/${step.id}/items?include=appStoreVersion&limit=20`)).data || [];
      const has = items.some((it) => it.relationships?.appStoreVersion?.data?.id === versionId);
      if (!has) {
        await api.post('/reviewSubmissionItems', {
          data: { type: 'reviewSubmissionItems', relationships: {
            reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
            appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } } },
        });
      }
      log(`reusing review submission ${submissionId} (${step.state}); version item ${has ? 'already present' : 'added'}`);
    } else if (step.kind === 'createSubmission') {
      const res = await api.post('/reviewSubmissions', {
        data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: appId } } } },
      });
      submissionId = res.data.id;
      await api.post('/reviewSubmissionItems', {
        data: { type: 'reviewSubmissionItems', relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } } },
      });
      log(`created review submission ${submissionId} with version ${versionId}`);
    } else if (step.kind === 'submit') {
      const res = await api.patch(`/reviewSubmissions/${submissionId}`, { data: { type: 'reviewSubmissions', id: submissionId, attributes: { submitted: true } } });
      log(`submitted for App Review: submission ${submissionId}, state ${res.data?.attributes?.state ?? 'unknown'}`);
    }
  }
  return { versionId, submissionId };
}

export function describe(state, opts) {
  const { steps, blockers, needs, done } = plan(state, opts);
  const lines = [];
  for (const b of state.builds) lines.push(`build ${b.attributes?.version}: ${b.attributes?.processingState}, encryption flag ${b.attributes?.usesNonExemptEncryption}`);
  for (const v of state.versions) lines.push(`version ${v.id} ${v.attributes?.versionString}: ${versionState(v)} (build ${v.buildNumber ?? 'none'}, release ${v.attributes?.releaseType ?? '?'})`);
  for (const s of state.subs) lines.push(`review submission ${s.id}: ${s.attributes?.state}${s.versionIds ? ` (versions ${s.versionIds.join(', ') || 'none'})` : ''}`);
  if (done) lines.push(`no-op: ${done}`);
  else lines.push('plan:', ...steps.map((s) => `  ${JSON.stringify(s)}`));
  if (needs.length) lines.push('submit needs:', ...needs.map((n) => `  ${n}`));
  if (blockers.length) lines.push('BLOCKERS:', ...blockers.map((b) => `  ${b}`));
  return { text: lines.join('\n'), blockers, needs };
}

async function main(env = process.env) {
  const mode = env.ASC_MODE;
  if (!['plan', 'submit'].includes(mode)) throw new Error('ASC_MODE must be plan or submit');
  const version = env.ASC_VERSION;
  const buildNumber = env.ASC_BUILD_NUMBER;
  const cancelSubmission = (env.ASC_CANCEL_SUBMISSION ?? '').trim();
  if (cancelSubmission && !/^[\w-]+$/.test(cancelSubmission)) throw new Error('ASC_CANCEL_SUBMISSION must be a review submission id');
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !/^\d+$/.test(buildNumber ?? '')) throw new Error('ASC_VERSION x.y.z and ASC_BUILD_NUMBER required');
  const appId = env.KC_ASC_APP_ID;
  if (!/^\d+$/.test(appId ?? '')) throw new Error('KC_ASC_APP_ID missing');
  const notes = readFileSync(env.ASC_NOTES_FILE, 'utf8').trim();
  if (notes.length < 50 || notes.length > 4000) throw new Error('review notes must be 50–4000 characters');
  const jwt = createAscJwt({ keyId: env.ASC_API_KEY_ID, issuerId: env.ASC_API_KEY_ISSUER_ID, privateKeyPem: env.ASC_API_KEY_P8 });
  const api = client({ jwt, write: mode === 'submit' });
  const state = await readState(api, { appId, version, buildNumber });
  const { text, blockers, needs } = describe(state, { version, buildNumber, cancelSubmission });
  console.log(text);
  if (mode === 'plan') {
    if (blockers.length) process.exitCode = 1;
    return;
  }
  if (blockers.length || needs.length) throw new Error(`not submitting: ${[...blockers, ...needs.map((n) => `needs ${n}`)].join('; ')}`);
  await execute(api, state, { appId, version, buildNumber, notes, cancelSubmission });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
