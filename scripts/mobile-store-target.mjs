#!/usr/bin/env node
// Resolves the commit a store workflow (testflight-ios.yml, play-internal.yml)
// builds and verifies it has a green CI push run on dev (D-195).
//
// workflow_call: requires inputs.ref (validated). workflow_dispatch on dev:
// optional inputs.ref, otherwise the dispatched tip (`GITHUB_SHA`) when it has
// its own successful CI push run on dev. Only if the tip cannot be certified
// do we walk back to the newest commit with one (same walk as mobile-nightly
// resolve). Since #2613 no `[skip ci]` version bump follows a merge, so no
// commit inherits a parent's certification any more.
//
// Version at release time (#2613): a manual dispatch also refuses a commit
// whose app/VERSION is not ahead of the last shipped release (highest `v*`
// tag) or when the tags cannot be read, so an already-released version is
// never uploaded. Mobile nightly opens the version PR (store-version.mjs).
// workflow_call (nightly, PROD store build) is gated by its caller.
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
import { tagNames, versionGate } from './store-version.mjs';

const DEV_BRANCH = 'dev';
const REFUSE_MSG = (sha) => `${sha} has no successful CI push run on dev; refusing to build it.`;

/** Certify `sha` for a dev store build: a successful dev push CI run on the commit itself. */
export async function certifyStoreBuildSha(api, repo, sha) {
  const runs = await fetchSuccessfulPushRunsForSha(api, repo, sha);
  if (branchFromPushRuns(runs) !== DEV_BRANCH) throw new Error(REFUSE_MSG(sha));
  return { sha, branch: DEV_BRANCH };
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

  // Dispatch with no explicit ref: prefer the tip, then walk back if the tip
  // cannot be certified (its CI may still be running).
  if (eventName === 'workflow_dispatch' && !inputRef) {
    const tip = (env.GITHUB_SHA || '').trim() || null;
    if (isCommitSha(tip)) {
      try {
        const certifiedTip = await certifyStoreBuildSha(api, repo, tip);
        return {
          sha: certifiedTip.sha,
          branch: certifiedTip.branch,
          resolvedFromGreenWalk: false,
        };
      } catch {
        // Tip has no green run (yet); walk back.
      }
    }
    const lookback = parseLookback(env.LOOKBACK);
    const resolvedGreenSha = await resolveNewestGreenDevSha(api, { repo, branch: 'dev', lookback });
    if (!resolvedGreenSha) {
      throw new Error(
        `No commit among the last ${lookback} on dev has a successful CI push run.`,
      );
    }
    const certified = await certifyStoreBuildSha(api, repo, resolvedGreenSha);
    return {
      sha: certified.sha,
      branch: certified.branch,
      resolvedFromGreenWalk: true,
    };
  }

  const sha = pickBuildSha({ eventName, inputRef, resolvedGreenSha: null });
  if (!isCommitSha(sha)) throw new Error(`Ref is not a commit SHA: ${sha}`);
  const certified = await certifyStoreBuildSha(api, repo, sha);

  return {
    sha: certified.sha,
    branch: certified.branch,
    resolvedFromGreenWalk: false,
  };
}

/** Manual dispatch only: refuse unless the commit's app/VERSION is ahead of the last release (fail-safe). */
export async function assertVersionAhead(api, repo, sha) {
  let version = null;
  let tags = null;
  try {
    version = (await api(`/repos/${repo}/contents/app/VERSION?ref=${sha}`)).content;
    version = Buffer.from(version, 'base64').toString();
    tags = tagNames(await api(`/repos/${repo}/git/matching-refs/tags/v`));
  } catch (err) {
    console.log(`::warning::Could not read app/VERSION or the release tags: ${err.message}`);
  }
  const gate = versionGate({ version, tags });
  if (!gate.ahead) throw new Error(`${gate.reason}. Not uploading; the Mobile nightly run opens the version PR.`);
  console.log(`Version gate: ${gate.reason}`);
  return gate;
}

async function main() {
  const target = await resolveStoreTarget(process.env);
  if (process.env.EVENT_NAME === 'workflow_dispatch') {
    await assertVersionAhead((path) => githubGet(path, process.env), process.env.GITHUB_REPOSITORY, target.sha);
  }
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
