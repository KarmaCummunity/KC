// Conditionally required third-party scans for the `CI gate` (scripts/ci-gate.mjs).
//
// GitGuardian and Snyk run as GitHub integrations, not as CI workflows, and
// are NOT required checks in the ruleset / branch protection: Snyk never
// reports on merge-queue commits, and a required context that never reports
// hangs "Expected". Instead the gate judges them on the head SHA it gates:
//   • absent (never appeared for this event type, after a short grace) → ignored;
//   • success / neutral / skipped → ok;
//   • failure / error / cancelled / timed_out / action_required / stale → gate fails;
//   • still pending after PENDING_WAIT_MS → gate fails with a clear message.
// Each scan is identified by its source as well as its name, so a workflow on
// any branch cannot fake or mask it:
//   • GitGuardian posts a check run → name AND GitHub App id (46505) must match;
//   • Snyk posts a commit status with a user token (no App) → the context must
//     be `security/snyk (<login>)` AND the status creator must be that same
//     <login>, a User on the allowlist. A workflow's GITHUB_TOKEN posts as
//     github-actions[bot], so it can neither fake nor hide it.
// Push and dispatch runs are not judged here (no PR head; deploys rely on them).
//
// Runs from the base commit like every judge module (ci.yml JUDGE_REF).

import { githubList } from './ci-github.mjs';

export const APP_CHECKS = [
  {
    id: 'gitguardian',
    label: 'GitGuardian (App 46505, check "GitGuardian Security Checks")',
    kind: 'check',
    name: 'GitGuardian Security Checks',
    appId: 46505,
    events: ['pull_request', 'pull_request_review', 'merge_group'],
  },
  {
    id: 'snyk',
    label: 'Snyk (status "security/snyk (<login>)")',
    kind: 'status',
    contextPrefix: 'security/snyk (',
    creators: ['navesarussi'],
    // Snyk posts no status on merge-queue commits.
    events: ['pull_request', 'pull_request_review'],
  },
];

/** How long a check that exists may stay pending before the gate fails. */
export const PENDING_WAIT_MS = 8 * 60 * 1000;
/** How long the gate waits for a check that has not appeared at all. */
export const ABSENT_GRACE_MS = 60 * 1000;
export const POLL_MS = 20 * 1000;

const OK_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

/** Newest first: by started_at, then id. */
function newest(items, at) {
  return [...items].sort((a, b) => String(at(b)).localeCompare(String(at(a))) || (b.id ?? 0) - (a.id ?? 0))[0];
}

/**
 * Classify one configured scan from the head SHA's check runs and statuses.
 * Returns { state: 'absent' | 'pending' | 'ok' | 'failed', detail }.
 */
export function classifyAppCheck(spec, { checkRuns = [], statuses = [] }) {
  if (spec.kind === 'check') {
    const mine = checkRuns.filter((c) => c.name === spec.name && c.app?.id === spec.appId);
    if (!mine.length) return { state: 'absent', detail: 'no check run from the App' };
    const run = newest(mine, (c) => c.started_at ?? c.completed_at ?? '');
    if (run.status !== 'completed') return { state: 'pending', detail: `check run is ${run.status}`, url: run.html_url };
    if (OK_CONCLUSIONS.has(run.conclusion)) return { state: 'ok', detail: run.conclusion, url: run.html_url };
    return { state: 'failed', detail: `concluded ${run.conclusion}`, url: run.details_url || run.html_url };
  }
  const allow = new Set(spec.creators.map((l) => l.toLowerCase()));
  const mine = statuses.filter((s) => {
    const login = s.creator?.login?.toLowerCase();
    return (
      s.creator?.type === 'User' &&
      allow.has(login) &&
      typeof s.context === 'string' &&
      s.context.toLowerCase() === `${spec.contextPrefix}${login})`
    );
  });
  if (!mine.length) return { state: 'absent', detail: 'no status from the integration' };
  const st = newest(mine, (s) => s.updated_at ?? s.created_at ?? '');
  if (st.state === 'pending') return { state: 'pending', detail: 'status is pending', url: st.target_url };
  if (st.state === 'success') return { state: 'ok', detail: 'success', url: st.target_url };
  return { state: 'failed', detail: `status ${st.state}${st.description ? `: ${st.description}` : ''}`, url: st.target_url };
}

/** Scans that apply to this event. */
export function appChecksFor(event) {
  return APP_CHECKS.filter((spec) => spec.events.includes(event));
}

/**
 * Decide from one snapshot. `elapsedMs` is the time since judging started.
 * Returns { done, errors, notes }.
 */
export function judgeSnapshot(specs, snapshot, elapsedMs) {
  const errors = [];
  const notes = [];
  let waiting = false;
  for (const spec of specs) {
    const { state, detail, url } = classifyAppCheck(spec, snapshot);
    const where = url ? ` (${url})` : '';
    if (state === 'failed') errors.push(`${spec.label} ${detail}${where}: fix the finding or have it resolved in the tool, then re-run CI`);
    else if (state === 'ok') notes.push(`${spec.label}: ${detail}`);
    else if (state === 'absent') {
      if (elapsedMs < ABSENT_GRACE_MS) waiting = true;
      else notes.push(`${spec.label}: did not report for this commit; not judged`);
    } else if (elapsedMs < PENDING_WAIT_MS) waiting = true;
    else errors.push(`${spec.label} still pending after ${Math.round(PENDING_WAIT_MS / 60000)} min${where}; re-run CI once it has finished`);
  }
  return { done: !waiting, errors, notes };
}

/** Read the head SHA's check runs and statuses. */
export async function readSnapshot(env) {
  const repo = env.GITHUB_REPOSITORY;
  const sha = env.HEAD_SHA;
  const checkRuns = await githubList(`/repos/${repo}/commits/${sha}/check-runs?filter=all`, 'check_runs', env);
  const statuses = await githubList(`/repos/${repo}/commits/${sha}/statuses`, null, env);
  return { checkRuns, statuses };
}

/**
 * Judge the scans for this run; polls until every applicable scan is decided.
 * Injectable `read`, `sleep` and `now` for tests.
 */
export async function appCheckErrors(env, { read = readSnapshot, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const specs = appChecksFor(env.EVENT_NAME);
  if (!specs.length) return { errors: [], notes: [`${env.EVENT_NAME} run: third-party scans not judged`] };
  if (!env.HEAD_SHA) return { errors: ['third-party scans: HEAD_SHA is missing'], notes: [] };
  const start = now();
  for (;;) {
    const verdict = judgeSnapshot(specs, await read(env), now() - start);
    if (verdict.done) return verdict;
    await sleep(POLL_MS);
  }
}
