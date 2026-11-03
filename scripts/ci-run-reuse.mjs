// Lane-result reuse for review-triggered CI runs (INFRA-CI-2).
//
// A `pull_request_review` run re-runs only the cheap lanes and takes every
// other lane's result from the PR's latest `pull_request` run for the same
// head SHA — but only after scripts/ci-run-binding.mjs proves that run is this
// PR's (same number, base, head branch and SHA, no sibling PR elsewhere, base
// judges unchanged) and that all its jobs come from one attempt.

import { githubGet, githubList, laneResults } from './ci-github.mjs';
import { attemptErrors, bindPrRun } from './ci-run-binding.mjs';

/**
 * The newest `pull_request` run that GitHub associates with PR `prNumber` on
 * base `baseRef`, or null. Only a candidate: `pull_requests` lists every open
 * PR whose head matches, so bindPrRun must still prove the run is this PR's.
 */
export function latestPullRequestRun(runs, prNumber, baseRef) {
  const mine = runs.filter(
    (r) => r.event === 'pull_request' && r.pull_requests?.some((p) => p.number === prNumber && p.base?.ref === baseRef),
  );
  mine.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  return mine[0] ?? null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lane results of this PR's latest `pull_request` CI run for its head SHA.
 * Waits up to `waitMs` for a run still in progress, so this review run's
 * verdict lands after that run's. Throws — the gate fails closed — when there
 * is no such run, it never finishes in time, it cannot be bound to this PR,
 * or its jobs mix attempts.
 * Inputs (env): GITHUB_REPOSITORY, HEAD_SHA, PR_NUMBER, BASE_REF, GITHUB_TOKEN.
 */
export async function reusedLaneResults(env, lanes, { waitMs = 12 * 60_000, pollMs = 20_000 } = {}) {
  const repo = env.GITHUB_REPOSITORY;
  const pr = Number(env.PR_NUMBER);
  const query = `event=pull_request&head_sha=${env.HEAD_SHA}&per_page=100`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const { workflow_runs: runs } = await githubGet(`/repos/${repo}/actions/workflows/ci.yml/runs?${query}`, env);
    const run = latestPullRequestRun(runs, pr, env.BASE_REF);
    if (!run) throw new Error(`no pull_request CI run of PR #${pr} into ${env.BASE_REF} exists for head ${env.HEAD_SHA}; push a commit or re-run CI`);
    if (run.status === 'completed') {
      const { errors } = await bindPrRun(run, repo, env, { pr, baseRef: env.BASE_REF });
      const jobs = errors.length ? [] : await githubList(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest`, 'jobs', env);
      errors.push(...attemptErrors(run, jobs));
      if (errors.length) throw new Error(`run ${run.html_url} cannot be reused: ${errors.join('; ')}`);
      return { run, results: laneResults(jobs, lanes) };
    }
    if (Date.now() >= deadline) throw new Error(`the latest pull_request CI run (${run.html_url}) is still ${run.status}`);
    console.log(`Waiting for ${run.html_url} (${run.status}) to finish…`);
    await sleep(pollMs);
  }
}
