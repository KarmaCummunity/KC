#!/usr/bin/env node
// Runtime guard: the first step of every job that can change an environment
// (the DB backup and migrations, Edge Functions, web, tag and rollback jobs of
// the deploy-*.yml stages). It refuses to continue unless the run is a
// legitimate deploy.yml run, so a new workflow that calls a stage directly,
// or a "Re-run failed jobs" of an old release, cannot touch production.
//
// Every target:
//   • github.workflow_ref names deploy.yml of this repository. Inside a
//     called workflow the `github` context belongs to the caller ("When a
//     reusable workflow is triggered by a caller workflow, the github context
//     is always associated with the caller workflow" — GitHub docs, Reusing
//     workflow configurations › github context), so a stage called from any
//     other workflow sees that workflow's ref here.
// Prod additionally:
//   • deploy.yml runs from refs/heads/main;
//   • `approve release` succeeded in THIS run attempt (APPROVED_ATTEMPT is its
//     output; a "Re-run failed jobs" attempt reuses the old one and fails —
//     use "Re-run all jobs", which asks for a fresh approval) and the run has
//     a recorded approval for the `production` environment;
//   • when given, BASELINE_ATTEMPT (the Cloudflare deployment recorded for
//     rollback) also comes from this attempt;
//   • RELEASE_SHA is still the main tip, and no v* release tag points at a
//     newer commit — an older release can never be redeployed over a newer.
//
// Env: WORKFLOW_REF, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT,
// GITHUB_TOKEN, TARGET (dev|prod), RELEASE_SHA, APPROVED_ATTEMPT,
// BASELINE_ATTEMPT (optional).

import { fileURLToPath } from 'node:url';
import { latestReleaseTag } from './release-version.mjs';

/** Reasons the workflow ref cannot deploy `target` (empty = ok). */
export function checkWorkflowRef({ workflowRef, repo, target }) {
  const orchestrator = `${repo}/.github/workflows/deploy.yml@`;
  if (!workflowRef?.startsWith(orchestrator)) {
    return [`this job may only run inside ${orchestrator}…, not ${workflowRef || '(none)'}`];
  }
  if (target === 'prod' && workflowRef !== `${orchestrator}refs/heads/main`) {
    return [`prod deploys only from deploy.yml on refs/heads/main, not ${workflowRef}`];
  }
  return [];
}

/** The approval and the recorded baseline must belong to this run attempt. */
export function checkAttempts({ runAttempt, approvedAttempt, baselineAttempt }) {
  const errors = [];
  if (approvedAttempt !== runAttempt) {
    errors.push(
      `the release was approved in attempt ${approvedAttempt || '(none)'}, this is attempt ${runAttempt}; use "Re-run all jobs" to approve again`,
    );
  }
  if (baselineAttempt !== undefined && baselineAttempt !== runAttempt) {
    errors.push(`the rollback baseline was recorded in attempt ${baselineAttempt || '(none)'}, not this attempt ${runAttempt}`);
  }
  return errors;
}

/** True when the run's approvals include an approved review of `production`. */
export function hasProductionApproval(approvals) {
  return approvals.some((a) => a.state === 'approved' && a.environments?.some((e) => e.name === 'production'));
}

/**
 * Reasons `releaseSha` is stale: not the main tip, or behind the latest
 * release tag (`compareStatus` is GitHub's compare status of tag...release).
 */
export function checkFreshness({ releaseSha, mainTip, latestTag, compareStatus }) {
  const errors = [];
  if (mainTip !== releaseSha) errors.push(`main has moved on to ${mainTip}; ${releaseSha} is no longer the release`);
  if (latestTag && !['ahead', 'identical'].includes(compareStatus)) {
    errors.push(`release tag ${latestTag} is on a commit newer than ${releaseSha} (compare: ${compareStatus})`);
  }
  return errors;
}

function githubApi(token, repo) {
  return async (path) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub API ${path} → HTTP ${res.status}`);
    return res.json();
  };
}

async function prodChecks(env, api) {
  const errors = checkAttempts({
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    approvedAttempt: env.APPROVED_ATTEMPT ?? '',
    baselineAttempt: env.BASELINE_ATTEMPT || undefined,
  });
  if (!hasProductionApproval(await api(`/actions/runs/${env.GITHUB_RUN_ID}/approvals`))) {
    errors.push('this run has no recorded approval for the production environment');
  }
  const mainTip = (await api('/branches/main')).commit.sha;
  const tags = await api('/tags?per_page=100');
  const latestTag = latestReleaseTag(tags.map((t) => t.name));
  const tagSha = tags.find((t) => t.name === latestTag)?.commit.sha;
  const compareStatus = latestTag ? (await api(`/compare/${tagSha}...${env.RELEASE_SHA}`)).status : null;
  errors.push(...checkFreshness({ releaseSha: env.RELEASE_SHA, mainTip, latestTag, compareStatus }));
  return errors;
}

async function main() {
  const env = process.env;
  if (!['dev', 'prod'].includes(env.TARGET) || !/^[0-9a-f]{40}$/.test(env.RELEASE_SHA ?? '')) {
    throw new Error(`TARGET must be dev|prod and RELEASE_SHA a commit SHA (got ${env.TARGET}, ${env.RELEASE_SHA})`);
  }
  const errors = checkWorkflowRef({ workflowRef: env.WORKFLOW_REF, repo: env.GITHUB_REPOSITORY, target: env.TARGET });
  if (errors.length === 0 && env.TARGET === 'prod') {
    errors.push(...(await prodChecks(env, githubApi(env.GITHUB_TOKEN, env.GITHUB_REPOSITORY))));
  }
  for (const e of errors) console.log(`::error title=deploy guard::${e}`);
  if (errors.length) process.exit(1);
  console.log(`Deploy guard passed (${env.TARGET}, ${env.RELEASE_SHA}).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.log(`::error title=deploy guard::${err.message}`);
    process.exit(1);
  });
}
