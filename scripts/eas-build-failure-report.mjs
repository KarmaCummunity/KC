#!/usr/bin/env node
// Print why an EAS cloud build failed, straight into the GitHub job log.
//
// `eas build --json --wait` only prints "✖ Build failed", so a red store job
// used to need an expo.dev login to see the cause. This reads the build id
// from the captured eas stderr (or argv), asks the Expo API for the error, downloads the build log files and prints the failing phase.
// EAS redacts secret-type env values in its logs; GitHub masks job secrets.
//
// Usage: node scripts/eas-build-failure-report.mjs <eas-stderr-file | build-id>
// Never fails the job by itself (exit 0); it only reports.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BUILD_ID_RE = /builds\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERESTING_RE = /error|failed|failure|what went wrong|exception|could not|cannot|unable to/i;

export function findBuildId(input) {
  if (UUID_RE.test(input)) return input;
  const m = BUILD_ID_RE.exec(input);
  return m ? m[1] : null;
}

/** Parse EAS (bunyan JSONL) log text into { phase, msg, marker, result } entries. */
export function parseLogLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      out.push({ phase: j.phase ?? null, msg: String(j.msg ?? ''), marker: j.marker ?? null, result: j.result ?? null });
    } catch {
      out.push({ phase: null, msg: line, marker: null, result: null });
    }
  }
  return out;
}

/**
 * The first phase that ended with result "fail" (later ones such as
 * FAIL_BUILD only restate it), else the last phase that started.
 */
export function failingPhase(entries) {
  let last = null;
  for (const e of entries) {
    if (e.marker === 'END_PHASE' && e.result === 'fail' && e.phase) return e.phase;
    if (e.marker === 'START_PHASE' && e.phase) last = e.phase;
  }
  return last;
}

export function summarize(entries, { tail = 200, matches = 120 } = {}) {
  const phase = failingPhase(entries);
  const inPhase = entries.filter((e) => e.msg && (phase == null || e.phase === phase));
  const hits = inPhase.filter((e) => INTERESTING_RE.test(e.msg)).slice(-matches);
  return { phase, hits: hits.map((e) => e.msg), tail: inPhase.slice(-tail).map((e) => e.msg) };
}

const BUILD_QUERY = `query BuildReport($id: ID!) {
  builds { byId(buildId: $id) { id status platform buildProfile logFiles error { errorCode message docsUrl } } }
}`;

/** Same Expo GraphQL API eas-cli uses; needs no project checkout. */
async function fetchBuild(id, token) {
  const res = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: BUILD_QUERY, variables: { id } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) {
    throw new Error(`HTTP ${res.status}: ${(body.errors ?? []).map((e) => e.message).join('; ')}`);
  }
  return body.data.builds.byId;
}

async function main() {
  const arg = process.argv[2] ?? '';
  const source = existsSync(arg) ? readFileSync(arg, 'utf8') : arg;
  const id = findBuildId(source);
  if (!id) {
    console.log('::warning::eas-build-failure-report: no EAS build id found');
    return;
  }
  const token = process.env.EXPO_TOKEN;
  if (!token) {
    console.log('::warning::eas-build-failure-report: EXPO_TOKEN is not set');
    return;
  }
  let view;
  try {
    view = await fetchBuild(id, token);
  } catch (err) {
    console.log(`::warning::EAS build ${id} lookup failed: ${err.message}`);
    return;
  }
  const err = view.error ?? {};
  console.log(`EAS build ${id}: status=${view.status} platform=${view.platform} profile=${view.buildProfile}`);
  console.log(`EAS error: ${err.errorCode ?? 'n/a'}: ${err.message ?? 'n/a'}`);
  if (err.message) console.log(`::error title=EAS build failed (${err.errorCode ?? 'unknown'})::${err.message.split('\n')[0]}`);
  const entries = [];
  for (const url of view.logFiles ?? []) {
    try {
      const res = await fetch(url);
      if (res.ok) entries.push(...parseLogLines(await res.text()));
    } catch {
      /* best effort */
    }
  }
  if (entries.length === 0) {
    console.log('No EAS log files could be downloaded.');
    return;
  }
  const s = summarize(entries);
  console.log(`Failing phase: ${s.phase ?? 'unknown'}`);
  console.log('::group::Error-looking lines in the failing phase');
  for (const l of s.hits) console.log(l);
  console.log('::endgroup::');
  console.log('::group::Last lines of the failing phase');
  for (const l of s.tail) console.log(l);
  console.log('::endgroup::');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => console.log(`::warning::eas-build-failure-report: ${e.message}`));
}
