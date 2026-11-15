#!/usr/bin/env node
// Resolves the commit a store workflow (testflight-ios.yml, play-internal.yml)
// builds and verifies it has a green CI push run on dev (D-195).
//
// workflow_call: requires inputs.ref (validated). workflow_dispatch on dev:
// optional inputs.ref, otherwise the dispatched tip (`GITHUB_SHA`) when that
// SHA is certified — including a `[skip ci]` version bump that inherits its
// parent's green `CI gate` (deploy-target.mjs bump shape), so the store build
// ships the latest app/VERSION. Only if the tip cannot be certified do we
// walk back to the newest commit with its own successful CI push run (same
// walk as mobile-nightly resolve). A certified bump SHA itself is built, not
// the parent.
//
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL (optional),
// EVENT_NAME, GITHUB_REF, GITHUB_SHA (ignored when resolving),
// INPUT_REF (optional), LOOKBACK (default 30).
// Outputs (GITHUB_OUTPUT): sha, branch.

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  bumpCommitErrors,
  findGatedRun,
} from './deploy-target.mjs';
import {
  branchFromPushRuns,
  fetchSuccessfulPushRunsForSha,
  isCommitSha,
  parseLookback,
  resolveNewestGreenDevSha,
} from './resolve-green-dev-sha.mjs';

const DEV_BRANCH = 'dev';
const REFUSE_MSG = (sha) => `${sha} has no successful CI push run on dev; refusing to build it.`;

/**
 * Certify `sha` for a dev store build: a successful dev push CI run on the
 * commit itself, or a verified version-only bump whose parent has a green
 * `CI gate` on dev (same policy as deploy-target.mjs).
 */
export async function certifyStoreBuildSha(api, repo, sha, { jobsOf }) {
  const runs = await fetchSuccessfulPushRunsForSha(api, repo, sha);
  const branch = branchFromPushRuns(runs);
  if (branch) {
    if (branch !== DEV_BRANCH) {
      throw new Error(REFUSE_MSG(sha));
    }
    return { sha, branch, inheritedFrom: null };
  }

  const commit = await api(`/repos/${repo}/commits/${sha}`);
  const shapeErrors = bumpCommitErrors(commit);
  if (shapeErrors.length > 0) {
    throw new Error(REFUSE_MSG(sha));
  }

  const parent = commit.parents[0].sha;
  const parentRuns = (
    await api(
      `/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${parent}&event=push&per_page=20`,
    )
  ).workflow_runs;
  const runId = await findGatedRun(parentRuns, jobsOf, new Set([DEV_BRANCH]));
  if (!runId) {
    throw new Error(
      `${REFUSE_MSG(sha)} (certified version bump, but parent ${parent} has no green "CI gate" on dev)`,
    );
  }

  return { sha, branch: DEV_BRANCH, inheritedFrom: parent };
}

/** Fail closed when manual dispatch is not from the dev branch ref. */
export function assertDevDispatchAllowed(eventName, githubRef) {
  if (eventName === 'workflow_dispatch' && githubRef !== 'refs/heads/dev') {
    throw new Error(`Manual store runs are allowed only on dev (got ${githubRef}).`);
  }
}

/**
 * Commit to build: explicit ref from workflow_call / dispatch input, or a
 * pre-resolved green SHA for dispatch without input.
 */
export function pickBuildSha({ eventName, inputRef, resolvedGreenSha }) {
  if (eventName === 'workflow_call') {
    if (!inputRef) throw new Error('workflow_call requires inputs.ref');
    return inputRef;
  }
  if (inputRef) return inputRef;
  if (!resolvedGreenSha) {
    throw new Error('No green dev commit found within the lookback window.');
  }
  return resolvedGreenSha;
}

async function githubGet(path, env) {
  const base = env.GITHUB_API_URL || 'https://api.github.com';
  const res = await fetch(`${base}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function writeOutputs(outputs) {
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

export async function resolveStoreTarget(env, api = (path) => githubGet(path, env)) {
  const repo = env.GITHUB_REPOSITORY;
  const eventName = env.EVENT_NAME;
  const inputRef = (env.INPUT_REF || '').trim() || null;

  assertDevDispatchAllowed(eventName, env.GITHUB_REF);

  const jobsOf = async (runId) =>
    (await api(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`)).jobs;

  // Dispatch with no explicit ref: prefer the tip so a [skip ci] bump still
  // ships the latest version, then walk back if the tip cannot be certified.
  if (eventName === 'workflow_dispatch' && !inputRef) {
    const tip = (env.GITHUB_SHA || '').trim() || null;
    if (isCommitSha(tip)) {
      try {
        const certifiedTip = await certifyStoreBuildSha(api, repo, tip, { jobsOf });
        return {
          sha: certifiedTip.sha,
          branch: certifiedTip.branch,
          inheritedFrom: certifiedTip.inheritedFrom,
          resolvedFromGreenWalk: false,
        };
      } catch {
        // Tip has no green run and is not a certified bump; walk back.
      }
    }
    const lookback = parseLookback(env.LOOKBACK);
    const resolvedGreenSha = await resolveNewestGreenDevSha(api, { repo, branch: 'dev', lookback });
    if (!resolvedGreenSha) {
      throw new Error(
        `No commit among the last ${lookback} on dev has a successful CI push run.`,
      );
    }
    const certified = await certifyStoreBuildSha(api, repo, resolvedGreenSha, { jobsOf });
    return {
      sha: certified.sha,
      branch: certified.branch,
      inheritedFrom: certified.inheritedFrom,
      resolvedFromGreenWalk: true,
    };
  }

  const sha = pickBuildSha({ eventName, inputRef, resolvedGreenSha: null });
  if (!isCommitSha(sha)) throw new Error(`Ref is not a commit SHA: ${sha}`);
  const certified = await certifyStoreBuildSha(api, repo, sha, { jobsOf });

  return {
    sha: certified.sha,
    branch: certified.branch,
    inheritedFrom: certified.inheritedFrom,
    resolvedFromGreenWalk: false,
  };
}

async function main() {
  const target = await resolveStoreTarget(process.env);
  writeOutputs({ sha: target.sha, branch: target.branch });
  if (target.resolvedFromGreenWalk) {
    console.log(`Resolved past dev tip to green commit ${target.sha}`);
  }
  if (target.inheritedFrom) {
    console.log(
      `::notice::${target.sha} is a certified version-only bump; build certification inherited from parent ${target.inheritedFrom} (green CI gate on dev).`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.log(`::error::${err.message}`);
    process.exit(1);
  });
}
