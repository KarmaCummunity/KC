#!/usr/bin/env node
// Verdict for the `CI gate` job in .github/workflows/ci.yml — the only
// required status check on `dev` and `main`.
//
// GitHub counts a skipped job as passing, so the gate cannot just mirror its
// needs. It fails closed. It fails when:
//   • the PR is a draft (CI did not run; `ready_for_review` re-triggers it, and
//     a green gate on the draft's head SHA would otherwise satisfy branch
//     protection before the real run reports);
//   • a manual dispatch ran on a ref other than dev/main (it would post a gate
//     verdict on a commit without the PR checks);
//   • the change detector failed or produced no plan;
//   • any needed job failed or was cancelled;
//   • a lane job is not in the plan, or a planned lane is missing from the
//     gate's `needs:`;
//   • a lane the plan marks as needed did not succeed (e.g. it was skipped);
//   • a merge group, push or dispatch plans any lane but `hygiene` as not
//     needed (they run every lane), or a PR into main plans a heavy lane as
//     not needed while its frontend lane is (only dev has a merge queue that
//     runs heavy lanes later) — see `deferralErrors`;
//   • the PR changed ci.yml's jobs or header (scripts/ci-workflow-diff.mjs)
//     and no owner approved its head SHA (TD-203);
//   • a PR or review run targets a base other than dev/main;
//   • on a review event, the PR's latest `pull_request` run for the head SHA
//     is missing, unfinished after a wait, or cannot be bound to this PR and
//     base (scripts/ci-run-binding.mjs), so there are no lane results to reuse.
// A lane may be skipped only when the plan explicitly marks it not needed,
// and only a PR into dev may mark a heavy lane not needed for a frontend change.
//
// Review events (`pull_request_review`) exist so an owner approval can flip a
// gate the test-integrity guard or the ci.yml check turned red. They re-run
// only REVIEW_LANES; every other lane's result comes from the latest completed
// `pull_request` run of this PR for the same head SHA, read via the API.
//
// This job's own `CI gate` check can be imitated by any workflow on any
// branch, so branch protection trusts `CI verdict` (scripts/ci-verdict.mjs),
// which re-verifies the run this gate belongs to.
//
// ci.yml runs this file, and every module it imports, from the base commit.
//
// Inputs (env): NEEDS (toJSON(needs)), PLAN (JSON object lane → needed, from
// scripts/ci-changes.mjs), DRAFT ('true' | 'false'), EVENT_NAME, REF,
// BASE_REF, JUDGE_REF (base commit), BASE_SHA, HEAD_SHA, PR_NUMBER, PR_AUTHOR,
// GITHUB_REPOSITORY, GITHUB_TOKEN.

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HEAVY_LANES, LANE_JOBS, OPTIONAL_LANES as OPTIONAL_LANE_IDS, PR_ONLY_LANES, REVIEW_LANES } from './ci-changes.mjs';
import { findOwnerOverride } from './ci-github.mjs';
import { PROTECTED } from './ci-run-binding.mjs';
import { reusedLaneResults } from './ci-run-reuse.mjs';
import { workflowDrift } from './ci-workflow-diff.mjs';

const DISPATCH_REFS = new Set(['refs/heads/dev', 'refs/heads/main']);
const PR_EVENTS = new Set(['pull_request', 'pull_request_review']);

// Lanes the change detector names only when needed (scripts/ci-changes.mjs,
// loaded from the same base commit). Absent from the plan, such a lane is
// "not needed" and may only have been skipped.
// A heavy lane is never optional: the plan must name it, and only an explicit
// `false` (where deferral is allowed) lets it skip.
const OPTIONAL_LANES = new Set(OPTIONAL_LANE_IDS.filter((lane) => !HEAVY_LANES.includes(lane)));

/**
 * Errors for lanes this event may not plan as not needed. A PR or review into
 * dev may defer anything its diff does not need, heavy lanes included: the dev
 * merge queue runs every lane before the PR lands. A PR into main has no queue
 * after it, so a heavy lane must be needed whenever `frontend` is. A merge
 * group, push or dispatch runs every lane but the PR-only ones.
 */
export function deferralErrors({ plan, event, baseRef }) {
  const base = baseRef?.replace(/^refs\/heads\//, '');
  if (PR_EVENTS.has(event)) {
    if (base === 'dev') return [];
    return HEAVY_LANES.filter((lane) => plan[lane] === false && plan.frontend === true).map(
      (lane) => `job "${lane}" is planned as not needed on a PR into ${base || 'an unknown base'}; only PRs into dev may leave it to the merge queue`,
    );
  }
  return LANE_JOBS
    .filter((lane) => !PR_ONLY_LANES.includes(lane) && plan[lane] !== true)
    .map((lane) => `job "${lane}" must run on every ${event} run, but the plan ${lane in plan ? 'marks it not needed' : 'leaves it out'}`);
}

/** Return the list of reasons the gate must fail (empty = pass). */
export function evaluateGate({ needs, plan, draft, event, ref, baseRef }) {
  if (draft) {
    return ['Draft PR: CI does not run on drafts. Mark the PR ready for review to run the full gate.'];
  }
  if (event === 'workflow_dispatch' && !DISPATCH_REFS.has(ref)) {
    return [`Manual runs gate only dev or main (got ${ref}); open or update a PR to run CI on this commit.`];
  }
  const detector = needs.changes?.result;
  if (detector !== 'success') return [`change detector did not succeed (result: ${detector ?? 'missing'})`];
  if (!plan || typeof plan !== 'object' || Object.keys(plan).length === 0) {
    return ['change detector produced no lane plan'];
  }
  const errors = [];
  for (const [job, { result }] of Object.entries(needs)) {
    if (result === 'failure' || result === 'cancelled') errors.push(`job "${job}" ${result}`);
    else if (job !== 'changes' && typeof plan[job] !== 'boolean' && !(OPTIONAL_LANES.has(job) && result === 'skipped')) {
      errors.push(`job "${job}" is not in the change detector's plan`);
    }
  }
  for (const [job, needed] of Object.entries(plan)) {
    const result = needs[job]?.result;
    if (result === undefined) {
      errors.push(`job "${job}" is planned but missing from the gate's needs: list`);
    } else if (needed === true && result === 'skipped') {
      errors.push(`job "${job}" is needed for this change but was skipped`);
    } else if (needed === true && result !== 'success' && result !== 'failure' && result !== 'cancelled') {
      errors.push(`job "${job}" is needed for this change but ended ${result}`);
    }
  }
  errors.push(...deferralErrors({ plan, event, baseRef }));
  return errors;
}

/**
 * The needs a review-event run is judged on: its own result for `changes` and
 * REVIEW_LANES, and the earlier `pull_request` run's result for every other
 * lane (`missing` when that run has none, which fails a needed lane). An
 * optional lane is replaced only when this ci.yml has the job.
 */
export function mergeReused(needs, reused) {
  const merged = { ...needs };
  for (const lane of [...LANE_JOBS, ...OPTIONAL_LANE_IDS]) {
    if (REVIEW_LANES.includes(lane) || (OPTIONAL_LANE_IDS.includes(lane) && !(lane in needs))) continue;
    merged[lane] = { result: reused[lane] ?? 'missing' };
  }
  return merged;
}

/**
 * Errors from the ci.yml comparison: none when the PR leaves ci.yml alone or
 * an owner approved the head SHA. Pushes and dispatches run dev/main's own
 * ci.yml, so only PR-like events are compared.
 */
async function ciWorkflowErrors(env) {
  if (!['pull_request', 'pull_request_review', 'merge_group'].includes(env.EVENT_NAME)) return [];
  const drift = workflowDrift({ judgeRef: env.JUDGE_REF, runningRef: 'HEAD', baseSha: env.BASE_SHA, headSha: env.HEAD_SHA });
  if (drift.length === 0) return [];
  const override = await findOwnerOverride(env, env.JUDGE_REF);
  if (override.login) {
    for (const d of drift) console.log(`::notice::${d} — accepted: @${override.login} approved head ${env.HEAD_SHA}`);
    return [];
  }
  return [
    ...drift,
    `ci.yml must keep the base branch's lanes and jobs unless an owner approves this head SHA: ${override.why}.`,
  ];
}

/** Collect every gate error; any exception becomes an error (fail closed). */
async function judge(env, needs, plan) {
  const draft = env.DRAFT === 'true';
  if (PR_EVENTS.has(env.EVENT_NAME) && !PROTECTED.has(env.BASE_REF)) {
    return { judged: needs, errors: [`PR base is ${env.BASE_REF || 'unknown'}: CI gates only PRs into dev or main`] };
  }
  const errors = [];
  let judged = needs;
  if (env.EVENT_NAME === 'pull_request_review' && !draft) {
    try {
      const { run, results } = await reusedLaneResults(env, [...LANE_JOBS, ...OPTIONAL_LANE_IDS]);
      console.log(`Review event: reusing lane results of ${run.html_url}`);
      judged = mergeReused(needs, results);
    } catch (err) {
      errors.push(`review re-evaluation has no lane results to reuse: ${err.message}`);
    }
  }
  errors.push(...evaluateGate({ needs: judged, plan, draft, event: env.EVENT_NAME, ref: env.REF, baseRef: env.BASE_REF }));
  if (!draft) {
    try {
      errors.push(...(await ciWorkflowErrors(env)));
    } catch (err) {
      errors.push(`could not compare ci.yml with the base commit: ${err.message}`);
    }
  }
  return { judged, errors };
}

function parseJson(name, raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} is not valid JSON: ${raw}`);
  }
}

async function main() {
  const env = process.env;
  const plan = parseJson('PLAN', env.PLAN);
  const { judged, errors } = await judge(env, parseJson('NEEDS', env.NEEDS) ?? {}, plan);
  const rows = Object.entries(judged).map(
    ([job, { result }]) => `| ${job} | ${result} | ${job === 'changes' ? '-' : String(plan?.[job] ?? 'unplanned')} |`,
  );
  const summary = ['| Job | Result | Needed |', '| --- | --- | --- |', ...rows].join('\n');
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (errors.length) {
    for (const e of errors) console.log(`::error::${e}`);
    process.exit(1);
  }
  console.log('CI gate passed.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
