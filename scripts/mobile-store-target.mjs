#!/usr/bin/env node
// Resolves the commit a store workflow (testflight-ios.yml, play-internal.yml)
// builds and verifies it has a green CI push run on dev (D-195).
//
// workflow_call: requires inputs.ref (validated). workflow_dispatch on dev:
// optional inputs.ref, otherwise the newest green dev commit (same walkback
// as mobile-nightly resolve).
//
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL (optional),
// EVENT_NAME, GITHUB_REF, GITHUB_SHA (ignored when resolving),
// INPUT_REF (optional), LOOKBACK (default 30).
// Outputs (GITHUB_OUTPUT): sha, branch.

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  branchFromPushRuns,
  fetchSuccessfulPushRunsForSha,
  isCommitSha,
  parseLookback,
  resolveNewestGreenDevSha,
} from './resolve-green-dev-sha.mjs';

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

  let resolvedGreenSha = null;
  if (eventName === 'workflow_dispatch' && !inputRef) {
    const branch = 'dev';
    const lookback = parseLookback(env.LOOKBACK);
    resolvedGreenSha = await resolveNewestGreenDevSha(api, { repo, branch, lookback });
    if (!resolvedGreenSha) {
      throw new Error(
        `No commit among the last ${lookback} on ${branch} has a successful CI push run.`,
      );
    }
  }

  const sha = pickBuildSha({ eventName, inputRef, resolvedGreenSha });
  if (!isCommitSha(sha)) throw new Error(`Ref is not a commit SHA: ${sha}`);

  const runs = await fetchSuccessfulPushRunsForSha(api, repo, sha);
  const branch = branchFromPushRuns(runs);
  if (!branch) {
    throw new Error(`${sha} has no successful CI push run on dev; refusing to build it.`);
  }

  return { sha, branch, resolvedFromGreenWalk: Boolean(resolvedGreenSha && !inputRef) };
}

async function main() {
  const target = await resolveStoreTarget(process.env);
  writeOutputs({ sha: target.sha, branch: target.branch });
  if (target.resolvedFromGreenWalk) {
    console.log(`Resolved past dev tip to green commit ${target.sha}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.log(`::error::${err.message}`);
    process.exit(1);
  });
}
