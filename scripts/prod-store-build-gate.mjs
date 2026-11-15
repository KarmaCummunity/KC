#!/usr/bin/env node
/**
 * Gate the automatic PROD store-build pipeline.
 *
 * A store build may proceed only when all of the following hold:
 *   1. KC_PROD_STORE_BUILD_ENABLED is exactly "true" (unset / any other
 *      value = fail closed; default is block). This script never sets the var.
 *   2. The triggering event is a successful PROD Deploy on main whose
 *      "tag release" job succeeded (a skipped-only Deploy on main must not
 *      start a store build), or a workflow_dispatch of a SHA that is on
 *      main and has a v* tag pointing at it.
 *
 * workflow_run of Deploy fires on every completed Deploy, including the
 * common "resolve-only, everything else skipped" success on main. Those
 * are skipped quietly (exit 0, proceed=false). A real tagged PROD release
 * with the flag still off fails closed so the block is visible.
 *
 * Does not approve production, does not publish, does not write to kc-prod.
 */
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_RE = /^[0-9a-f]{40}$/i;

export const ENABLED_VAR = 'KC_PROD_STORE_BUILD_ENABLED';
export const TAG_JOB_NAME = 'tag release';

export function isStoreBuildEnabled(raw) {
  return String(raw ?? '').trim() === 'true';
}

export function enabledErrors(raw) {
  if (isStoreBuildEnabled(raw)) return [];
  return [
    `${ENABLED_VAR} is not true (default: block). The automatic PROD store-build pipeline will not run until this repo variable is set to exactly true.`,
  ];
}

/**
 * Classify a completed Deploy workflow_run.
 * @returns {{ kind: 'prod-tagged' | 'not-prod-release', reason: string, sha?: string }}
 */
export function classifyDeployRun({ conclusion, headBranch, headSha, jobs }) {
  const sha = String(headSha ?? '').trim();
  if (String(conclusion ?? '') !== 'success') {
    return { kind: 'not-prod-release', reason: `Deploy conclusion is "${conclusion ?? ''}", not success` };
  }
  if (String(headBranch ?? '') !== 'main') {
    return { kind: 'not-prod-release', reason: `Deploy head branch is "${headBranch ?? ''}", not main` };
  }
  if (!SHA_RE.test(sha)) {
    return { kind: 'not-prod-release', reason: 'Deploy head SHA is missing or not a 40-char hex' };
  }
  const tagJob = (jobs ?? []).find((j) => j && j.name === TAG_JOB_NAME);
  if (!tagJob) {
    return { kind: 'not-prod-release', reason: 'Deploy did not include a "tag release" job' };
  }
  if (tagJob.conclusion !== 'success') {
    return {
      kind: 'not-prod-release',
      reason: `"tag release" job conclusion is "${tagJob.conclusion ?? tagJob.status ?? ''}" (only a tagged PROD Deploy proceeds)`,
    };
  }
  return { kind: 'prod-tagged', reason: 'Deploy tagged a PROD release on main', sha: sha.toLowerCase() };
}

export function checkDispatchSha({ sha, aheadBy, tags }) {
  const errors = [];
  const value = String(sha ?? '').trim().toLowerCase();
  if (!SHA_RE.test(value)) {
    errors.push('workflow_dispatch requires a 40-character main SHA (inputs.sha)');
    return { errors, sha: value };
  }
  if (aheadBy !== 0) {
    errors.push(`SHA ${value} is not on main (compare main...sha ahead_by=${aheadBy ?? 'unknown'})`);
  }
  const vtags = (tags ?? []).filter((t) => /^v\d/.test(String(t).replace(/^refs\/tags\//, '')));
  if (vtags.length === 0) {
    errors.push(`SHA ${value} has no v* tag; PROD store builds only follow a tagged release`);
  }
  return { errors, sha: value, tags: vtags };
}

export function decide({ eventName, enabled, deploy, dispatch }) {
  if (eventName === 'workflow_dispatch') {
    const { errors: shaErrors, sha, tags } = checkDispatchSha(dispatch ?? {});
    const errors = [...enabledErrors(enabled), ...shaErrors];
    return {
      proceed: errors.length === 0,
      quiet: false,
      sha: errors.length === 0 ? sha : undefined,
      tag: tags?.[0],
      errors,
    };
  }
  if (eventName === 'workflow_run') {
    const classified = classifyDeployRun(deploy ?? {});
    if (classified.kind !== 'prod-tagged') {
      return { proceed: false, quiet: true, errors: [], reason: classified.reason };
    }
    const errors = enabledErrors(enabled);
    return {
      proceed: errors.length === 0,
      quiet: false,
      sha: classified.sha,
      errors,
      reason: classified.reason,
    };
  }
  return {
    proceed: false,
    quiet: false,
    errors: [`unsupported event "${eventName ?? ''}" for the PROD store-build gate`],
  };
}

export function tagsPointingAt(refs, sha, resolved) {
  const want = String(sha).toLowerCase();
  const out = [];
  for (const r of refs ?? []) {
    const name = String(r.ref ?? '').replace(/^refs\/tags\//, '');
    const obj = r.object ?? {};
    let commit = String(obj.sha ?? '').toLowerCase();
    if (obj.type === 'tag' && resolved && resolved[obj.sha]) {
      commit = String(resolved[obj.sha].object?.sha ?? resolved[obj.sha].sha ?? '').toLowerCase();
    }
    if (commit === want) out.push(name);
  }
  return out;
}

async function githubJson(repo, path, token) {
  const url = `https://api.github.com/repos/${repo}${path}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function loadJobs(repo, runId, token) {
  const jobs = [];
  let page = 1;
  for (;;) {
    const data = await githubJson(
      repo,
      `/actions/runs/${runId}/jobs?per_page=100&page=${page}`,
      token,
    );
    jobs.push(...(data.jobs ?? []));
    if (!data.jobs || data.jobs.length < 100) break;
    page += 1;
  }
  return jobs;
}

async function loadTagsForSha(repo, sha, token) {
  const refs = await githubJson(repo, '/git/matching-refs/tags/v', token);
  const resolved = {};
  for (const r of refs ?? []) {
    if (r.object?.type === 'tag') {
      resolved[r.object.sha] = await githubJson(repo, `/git/tags/${r.object.sha}`, token);
    }
  }
  return tagsPointingAt(refs, sha, resolved);
}

function writeOutput(io, key, value) {
  if (!io.outputPath) return;
  const append = io.fs?.appendFileSync ?? appendFileSync;
  append(io.outputPath, `${key}=${value}\n`);
}

export async function main(env, io = {}) {
  const eventName = env.EVENT_NAME ?? '';
  let deploy;
  let dispatch;
  if (eventName === 'workflow_run') {
    const repo = env.GITHUB_REPOSITORY;
    const runId = env.WORKFLOW_RUN_ID;
    const token = env.GITHUB_TOKEN;
    const jobs = io.jobs ?? (await loadJobs(repo, runId, token));
    deploy = {
      conclusion: env.WORKFLOW_RUN_CONCLUSION,
      headBranch: env.WORKFLOW_RUN_HEAD_BRANCH,
      headSha: env.WORKFLOW_RUN_HEAD_SHA,
      jobs,
    };
  } else if (eventName === 'workflow_dispatch') {
    const repo = env.GITHUB_REPOSITORY;
    const token = env.GITHUB_TOKEN;
    const sha = String(env.INPUT_SHA ?? '').trim();
    let aheadBy = io.aheadBy;
    let tags = io.tags;
    if (aheadBy === undefined && SHA_RE.test(sha)) {
      const cmp = await githubJson(repo, `/compare/main...${sha}`, token);
      aheadBy = cmp.ahead_by;
    }
    if (tags === undefined && SHA_RE.test(sha)) {
      tags = await loadTagsForSha(repo, sha, token);
    }
    dispatch = { sha, aheadBy, tags };
  }

  const decision = decide({
    eventName,
    enabled: env.KC_PROD_STORE_BUILD_ENABLED,
    deploy,
    dispatch,
  });

  const log = io.log ?? console;
  if (decision.quiet) {
    log.info?.(`PROD store-build: skipping (${decision.reason})`) ?? log.log(`PROD store-build: skipping (${decision.reason})`);
    writeOutput(io, 'proceed', 'false');
    return 0;
  }
  if (!decision.proceed) {
    for (const e of decision.errors) (log.error ?? log.log)(`::error::${e}`);
    writeOutput(io, 'proceed', 'false');
    return 1;
  }
  (log.info ?? log.log)(`PROD store-build gate passed for ${decision.sha}`);
  writeOutput(io, 'proceed', 'true');
  writeOutput(io, 'sha', decision.sha);
  if (decision.tag) writeOutput(io, 'tag', decision.tag);
  return 0;
}

const launched =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (launched) {
  const io = {
    outputPath: process.env.GITHUB_OUTPUT,
    fs: { appendFileSync },
    log: console,
  };
  main(process.env, io)
    .then((code) => {
      if (code) process.exit(code);
    })
    .catch((err) => {
      console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
