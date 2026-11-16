#!/usr/bin/env node
/**
 * Gate the automatic PROD store-build pipeline.
 *
 * A store build may proceed only when all of the following hold:
 *   1. The platform is enabled (fail closed; default is block; this script
 *      never sets a variable). iOS and Android are decided separately:
 *        KC_PROD_STORE_BUILD_IOS_ENABLED / KC_PROD_STORE_BUILD_ANDROID_ENABLED
 *      exactly "true" enables that platform, any other non-empty value
 *      (e.g. "false") disables it, and unset falls back to the legacy
 *      KC_PROD_STORE_BUILD_ENABLED (exactly "true" = both platforms).
 *      A disabled platform is skipped (notice) while the other still builds;
 *      the run fails closed only when no requested platform is enabled, or
 *      when a dispatch explicitly asked for a disabled platform.
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
export const PLATFORMS = ['ios', 'android'];
export const PLATFORM_VARS = {
  ios: 'KC_PROD_STORE_BUILD_IOS_ENABLED',
  android: 'KC_PROD_STORE_BUILD_ANDROID_ENABLED',
};
export const PLATFORM_LABELS = { ios: 'iOS (TestFlight)', android: 'Android (Play internal)' };
export const TAG_JOB_NAME = 'tag release';

/**
 * Deploy calls the tag job as a reusable workflow, so the Jobs API names it
 * "tag release / tag release" (caller job / called job). Accept the bare name
 * and that caller-prefixed form only; anything else is not the tag job.
 */
export function isTagJobName(name) {
  const n = String(name ?? '').trim();
  return n === TAG_JOB_NAME || n.startsWith(`${TAG_JOB_NAME} / `);
}

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
 * Whether one platform may build. Its own variable wins when set (only the
 * exact token "true" enables); unset falls back to the legacy shared flag.
 * @returns {{ enabled: boolean, source: string }}
 */
export function platformEnabled(platform, flags = {}) {
  const name = PLATFORM_VARS[platform];
  if (!name) throw new Error(`unknown platform "${platform}"`);
  const own = String(flags[name] ?? '').trim();
  if (own !== '') return { enabled: own === 'true', source: `${name}=${own}` };
  const legacy = String(flags[ENABLED_VAR] ?? '').trim();
  return { enabled: isStoreBuildEnabled(legacy), source: `${ENABLED_VAR}=${legacy || '(unset)'} (fallback)` };
}

/** Platforms a run asks for: '', 'both' (default) or one platform. */
export function requestedPlatforms(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'both') return { platforms: [...PLATFORMS], errors: [] };
  if (PLATFORMS.includes(v)) return { platforms: [v], errors: [] };
  return { platforms: [], errors: [`platform input must be both, ios or android (got "${raw}")`] };
}

/**
 * Per-platform plan. `explicit` = the caller named one platform, so a
 * disabled platform is an error instead of a quiet skip.
 */
export function planPlatforms({ flags = {}, platform } = {}) {
  const { platforms: requested, errors } = requestedPlatforms(platform);
  const explicit = requested.length === 1;
  const plan = {};
  const notices = [];
  for (const p of PLATFORMS) {
    const { enabled, source } = platformEnabled(p, flags);
    const isRequested = requested.includes(p);
    plan[p] = { requested: isRequested, enabled, build: isRequested && enabled, source };
    if (isRequested && !enabled) {
      const msg = `${PLATFORM_LABELS[p]} PROD store build is disabled (${source}).`;
      if (explicit) errors.push(`${msg} The dispatch asked for ${p} only.`);
      else notices.push(`${msg} Skipping it; the other platform is not affected.`);
    }
  }
  if (requested.length > 0 && !PLATFORMS.some((p) => plan[p].build) && errors.length === 0) {
    errors.push(
      `No requested platform is enabled (${PLATFORMS.map((p) => plan[p].source).join(', ')}). ` +
        `Set ${PLATFORM_VARS.ios} / ${PLATFORM_VARS.android} or ${ENABLED_VAR} to exactly true (default: block).`,
    );
  }
  return { plan, errors, notices };
}

/** Errors when no platform at all is enabled (used by the read-only ledger job). */
export function anyPlatformEnabledErrors(flags = {}) {
  return planPlatforms({ flags }).errors;
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
  const tagJob = (jobs ?? []).find((j) => j && isTagJobName(j.name));
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

export function decide({ eventName, enabled, flags, platform, deploy, dispatch }) {
  const allFlags = { [ENABLED_VAR]: enabled, ...(flags ?? {}) };
  if (eventName === 'workflow_dispatch') {
    const { errors: shaErrors, sha, tags } = checkDispatchSha(dispatch ?? {});
    const { plan, errors: platformErrors, notices } = planPlatforms({ flags: allFlags, platform });
    const errors = [...platformErrors, ...shaErrors];
    return {
      proceed: errors.length === 0,
      quiet: false,
      sha: errors.length === 0 ? sha : undefined,
      tag: tags?.[0],
      platforms: plan,
      notices,
      errors,
    };
  }
  if (eventName === 'workflow_run') {
    const classified = classifyDeployRun(deploy ?? {});
    if (classified.kind !== 'prod-tagged') {
      return { proceed: false, quiet: true, errors: [], notices: [], reason: classified.reason };
    }
    // A tagged release always asks for both platforms.
    const { plan, errors, notices } = planPlatforms({ flags: allFlags, platform: 'both' });
    return {
      proceed: errors.length === 0,
      quiet: false,
      sha: classified.sha,
      platforms: plan,
      notices,
      errors,
      reason: classified.reason,
    };
  }
  return {
    proceed: false,
    quiet: false,
    notices: [],
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
    flags: {
      [PLATFORM_VARS.ios]: env.KC_PROD_STORE_BUILD_IOS_ENABLED,
      [PLATFORM_VARS.android]: env.KC_PROD_STORE_BUILD_ANDROID_ENABLED,
    },
    platform: env.INPUT_PLATFORM,
    deploy,
    dispatch,
  });

  const log = io.log ?? console;
  const writePlatforms = (on) => {
    for (const p of PLATFORMS) writeOutput(io, p, on && decision.platforms?.[p]?.build ? 'true' : 'false');
  };
  if (decision.quiet) {
    log.info?.(`PROD store-build: skipping (${decision.reason})`) ?? log.log(`PROD store-build: skipping (${decision.reason})`);
    writeOutput(io, 'proceed', 'false');
    writePlatforms(false);
    return 0;
  }
  for (const n of decision.notices ?? []) (log.info ?? log.log)(`::notice::${n}`);
  if (!decision.proceed) {
    for (const e of decision.errors) (log.error ?? log.log)(`::error::${e}`);
    writeOutput(io, 'proceed', 'false');
    writePlatforms(false);
    return 1;
  }
  const building = PLATFORMS.filter((p) => decision.platforms[p].build);
  (log.info ?? log.log)(`PROD store-build gate passed for ${decision.sha}: ${building.join(' + ')}`);
  writeOutput(io, 'proceed', 'true');
  writePlatforms(true);
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
