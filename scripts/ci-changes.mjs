#!/usr/bin/env node
// Change detector for .github/workflows/ci.yml (the single `CI gate` check).
//
// Decides, for every lane job in ci.yml, whether this change needs it. The
// rules lean conservative on purpose: CI is the only review this repo gets, so
// a path that no lane claims and that is not provably inert turns every heavy
// lane on instead of slipping through untested.
//
// Only PRs and PR reviews are planned from their diff (D-195 addendum: PR =
// fast feedback, merge queue = full gate). A merge-queue group, a push to
// dev/main and a manual dispatch run every lane: nothing lands on dev without
// the full gate, and a green push run certifies the whole tree at that SHA
// (the nightly mobile builds and the deploys trust it; a docs-only push after
// a red or never-run push would otherwise come out green). A PR into dev also
// defers HEAVY_LANES to its merge-queue run.
//
// A review event (`pull_request_review`, so the gate re-judges owner
// overrides) plans the same lanes a `pull_request` run would, but runs only
// REVIEW_LANES; scripts/ci-gate.mjs takes every other lane's result from the
// PR's latest completed `pull_request` run for the same head SHA.
//
// Inputs (env): EVENT_NAME, DRAFT, ACTOR, REF, BASE_REF (PR / merge-group
// target branch), BASE_SHA, HEAD_SHA.
// Outputs ($GITHUB_OUTPUT): draft, one true/false flag per lane job and per
// optional lane (whether it runs in this workflow run), sonar, and plan — a
// JSON object mapping every lane job id to whether the change needs it.
// scripts/ci-gate.mjs requires the plan to name every lane explicitly; an
// optional lane is named only when it is needed.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// CI plumbing and the Node pin can break any lane, so they trigger all of them.
const SHARED = [/^\.github\//, /^\.nvmrc$/];

export const LANE_RULES = {
  frontend: [/^app\//, /^scripts\//, /^Dockerfile$/, /^sonar-project\.properties$/, ...SHARED],
  // DB validation also installs the app workspace (sqlProbes), so lockfile and
  // workspace manifests count. Edge Functions are excluded: the local stack
  // starts without the edge runtime.
  backend: [
    /^supabase\/(?!functions\/)/,
    /^app\/packages\/infrastructure-supabase\//,
    /^app\/(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/,
    /^scripts\//,
    ...SHARED,
  ],
  edge: [/^supabase\//, ...SHARED],
};

// Paths that cannot change any build, test or runtime behaviour.
export const INERT = [
  /^docs\//,
  /\.md$/,
  /^\.claude\//,
  /^\.cursor\//,
  /^PRD_V2_NOT_FOR_MVP\//,
  /^LICENSE$/,
];

const LANES = Object.keys(LANE_RULES);

/** Lanes only PR events need (the PR title and body); every other event plans them false. */
export const PR_ONLY_LANES = ['hygiene'];

/**
 * Heavy lanes: the frontend builds a PR into dev defers to its merge-queue
 * run. `bundles` (production web export + bundle budget + headless smoke,
 * iOS + Android Metro bundles) builds what the frontend lane checks, so it is
 * needed exactly when `frontend` is, except on a PR (or review) into dev: the
 * dev merge queue runs every lane before the PR lands. A PR into main has no
 * merge queue after it, so it runs them. scripts/ci-gate.mjs accepts a heavy
 * lane planned `false` only on PR events into dev.
 */
export const HEAVY_LANES = ['bundles'];

/** Every lane job id in ci.yml; the gate and the drift guard key on this list. */
export const LANE_JOBS = ['hygiene', 'static', ...LANES, ...HEAVY_LANES];

/**
 * Lanes that appear in the plan only when needed: `release`, the dev → main
 * lane (source branch, strict migration scan, VERSION bump, dev E2E), needed
 * for every PR or merge group whose base is main, whatever it touches. Never
 * planned as `false`, so a ci.yml without the job (and the gate copy that
 * predates it) keeps passing; scripts/ci-gate.mjs accepts the job as skipped
 * when the plan omits it. Keep in sync with OPTIONAL_LANES there.
 */
export const OPTIONAL_LANES = ['release'];

/** Map changed paths to the heavy lanes they need. */
export function classify(files) {
  const lanes = Object.fromEntries(LANES.map((l) => [l, false]));
  for (const file of files) {
    const hits = LANES.filter((l) => LANE_RULES[l].some((re) => re.test(file)));
    if (hits.length === 0 && !INERT.some((re) => re.test(file))) {
      for (const l of LANES) lanes[l] = true;
    }
    for (const l of hits) lanes[l] = true;
  }
  return lanes;
}

/** Events that belong to one PR: planned from their diff, they get the hygiene lane and Sonar. */
const PR_EVENTS = new Set(['pull_request', 'pull_request_review']);

/** Events planned from their diff; every other event (merge group, push, dispatch) runs every lane. */
export const DIFF_EVENTS = PR_EVENTS;

/**
 * Lanes a review event runs itself: the static lane holds the test-integrity
 * guard, whose verdict depends on owner approvals. Everything else is reused.
 */
export const REVIEW_LANES = ['static'];

/**
 * Build the CI plan. `files` is null when the diff could not be computed;
 * that (like a merge group, a push or a manual dispatch) runs every lane.
 * `plan` is what the change needs; `run` is what this workflow run executes
 * (they differ only on review events, which run REVIEW_LANES and reuse the
 * rest).
 */
export function plan({ event, draft, actor, ref, baseRef, files }) {
  const isPr = PR_EVENTS.has(event);
  if (isPr && draft) {
    const none = Object.fromEntries(LANE_JOBS.map((j) => [j, false]));
    return { draft: true, sonar: false, plan: none, run: none };
  }
  // A merge group for main is planned too; the release lane fails it (no
  // head branch to check), so main cannot use a merge queue to skip release
  // checks.
  const base = baseRef?.replace(/^refs\/heads\//, '');
  const release = (isPr || event === 'merge_group') && base === 'main';
  const allLanes = files === null || !DIFF_EVENTS.has(event);
  const lanes = allLanes ? Object.fromEntries(LANES.map((l) => [l, true])) : classify(files);
  const deferHeavy = isPr && base === 'dev';
  const heavy = Object.fromEntries(HEAVY_LANES.map((l) => [l, lanes.frontend && !deferHeavy]));
  // SonarCloud's free plan analyses only `main` and pull requests, so neither
  // merge-group commits nor dev pushes can be scanned; with the per-PR scan
  // gone from PRs into dev (D-195 addendum, TD-236), it gates PRs into main
  // and main pushes. Dependabot-triggered runs get no secrets.
  const sonarTarget = (isPr && base === 'main' && actor !== 'dependabot[bot]') || (!isPr && event !== 'merge_group' && ref === 'refs/heads/main');
  const needed = { hygiene: isPr, static: true, ...lanes, ...heavy, ...(release ? { release: true } : {}) };
  if (event === 'pull_request_review') {
    const jobs = [...LANE_JOBS, ...OPTIONAL_LANES];
    const run = Object.fromEntries(jobs.map((j) => [j, needed[j] === true && REVIEW_LANES.includes(j)]));
    return { draft: false, sonar: false, plan: needed, run };
  }
  return { draft: false, sonar: lanes.frontend && sonarTarget, plan: needed, run: needed };
}

const ZERO_SHA = /^0+$/;

/**
 * Paths changed between the merge-base of `base` and `head`, or null when
 * unknown. `--no-renames` lists both sides of a move, so moving code into an
 * inert path (e.g. app/x.ts → docs/x.md) still triggers the code's lane; it
 * also avoids content reads that would lazily fetch blobs in a blobless clone.
 */
export function changedFiles(base, head, cwd = process.cwd()) {
  if (!base || !head || ZERO_SHA.test(base)) return null;
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--no-renames', `${base}...${head}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.split('\n').filter(Boolean);
  } catch (err) {
    console.log(`::warning::git diff ${base}...${head} failed (${err.message.split('\n')[0]}) — running every lane`);
    return null;
  }
}

function main() {
  const env = process.env;
  const files = DIFF_EVENTS.has(env.EVENT_NAME) ? changedFiles(env.BASE_SHA, env.HEAD_SHA) : null;
  const result = plan({
    event: env.EVENT_NAME,
    draft: env.DRAFT === 'true',
    actor: env.ACTOR,
    ref: env.REF,
    baseRef: env.BASE_REF,
    files,
  });
  const lines = [
    `draft=${result.draft}`,
    `sonar=${result.sonar}`,
    ...LANE_JOBS.map((job) => `${job}=${result.run[job]}`),
    ...OPTIONAL_LANES.map((job) => `${job}=${result.run[job] === true}`),
    `plan=${JSON.stringify(result.plan)}`,
  ];
  console.log(`changed files: ${files === null ? 'not diffed (all lanes)' : files.length}`);
  console.log(lines.join('\n'));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
