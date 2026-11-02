#!/usr/bin/env node
// Shared logic for picking the newest `dev` commit with a successful `CI`
// push run (D-195). Used by mobile-nightly resolve and manual store workflows
// when the branch tip is a `[skip ci]` bump commit with no CI run.

/** Parse LOOKBACK; one API page holds at most 100 commits, so larger values are refused. */
export function parseLookback(raw) {
  const n = Number(raw ?? 30);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw new Error(`LOOKBACK must be an integer from 1 to 100 (got "${raw}")`);
  }
  return n;
}

/** Return the first SHA in `commitShas` (newest first) that has a green CI push run. */
export function pickGreenSha(commitShas, greenShas) {
  const green = new Set(greenShas);
  return commitShas.find((sha) => green.has(sha)) ?? null;
}

/** True when `sha` looks like a full Git commit id. */
export function isCommitSha(sha) {
  return typeof sha === 'string' && /^[0-9a-f]{40}$/i.test(sha);
}

/**
 * Store branch for a commit with successful CI push runs on dev or main.
 * Main wins so mobile-store-config.mjs refuses prod store builds.
 */
export function branchFromPushRuns(workflowRuns) {
  const branches = new Set(
    workflowRuns
      .map((r) => r.head_branch)
      .filter((b) => b === 'dev' || b === 'main'),
  );
  if (branches.has('main')) return 'main';
  if (branches.has('dev')) return 'dev';
  return null;
}

/**
 * Newest commit on `branch` among the last `lookback` commits that has a
 * successful CI push run. `api` is async (path) => json.
 */
export async function resolveNewestGreenDevSha(api, { repo, branch, lookback }) {
  const commits = await api(`/repos/${repo}/commits?sha=${branch}&per_page=${lookback}`);
  const runs = await api(
    `/repos/${repo}/actions/workflows/ci.yml/runs?branch=${branch}&event=push&status=success&per_page=100`,
  );
  return pickGreenSha(
    commits.map((c) => c.sha),
    runs.workflow_runs.map((r) => r.head_sha),
  );
}

/** Successful push CI runs for an exact commit SHA. */
export async function fetchSuccessfulPushRunsForSha(api, repo, sha) {
  const { workflow_runs: runs } = await api(
    `/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&status=success`,
  );
  return runs;
}
