// Compares the ci.yml a PR runs with the base commit's ci.yml (TD-203).
//
// ci.yml is read from the PR, so a PR could rewire its own lanes or gate job
// (drop a lane from `needs:`, replace the judge step, change a lane's `if:`).
// scripts/ci-gate.mjs runs this from the BASE commit's copy and fails the gate
// when the PR changed ci.yml in anything but comments and blank lines, unless
// an owner approved the head SHA. The job split reuses the drift guard's
// parser (scripts/check-required-checks-drift.mjs) so both read ci.yml alike.
//
// The comparison is deliberately strict — any job or header change counts,
// not only lane names — because a one-line `run:` edit in the gate job is as
// effective at neutering CI as removing a lane.

import { execFileSync } from 'node:child_process';
import { splitJobs } from './check-required-checks-drift.mjs';

export const CI_WORKFLOW = '.github/workflows/ci.yml';

/** Drop whole-line comments, blank lines and trailing spaces. */
export function normalize(text) {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '' && !/^\s*#/.test(line))
    .join('\n');
}

/**
 * List how `headText` differs from `baseText`, one human-readable entry per
 * added, removed or changed job, plus one for the workflow header (triggers,
 * concurrency, permissions, env). Empty = same lanes and jobs.
 */
export function compareWorkflows(baseText, headText) {
  const base = splitJobs(baseText);
  const head = splitJobs(headText);
  if (!base || !head) return [`${CI_WORKFLOW}: no top-level jobs: block in the ${base ? 'PR' : 'base'} copy`];
  const diffs = [];
  if (normalize(base.header) !== normalize(head.header)) {
    diffs.push(`${CI_WORKFLOW}: triggers, concurrency, permissions or env changed`);
  }
  const baseJobs = new Map(base.jobs.map((j) => [j.id, normalize(j.text)]));
  const headJobs = new Map(head.jobs.map((j) => [j.id, normalize(j.text)]));
  for (const [id, text] of headJobs) {
    if (!baseJobs.has(id)) diffs.push(`${CI_WORKFLOW}: job "${id}" added`);
    else if (baseJobs.get(id) !== text) diffs.push(`${CI_WORKFLOW}: job "${id}" changed`);
  }
  for (const id of baseJobs.keys()) {
    if (!headJobs.has(id)) diffs.push(`${CI_WORKFLOW}: job "${id}" removed`);
  }
  return diffs;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Whether the PR's own commits (merge-base of base and head → head) touch
 * ci.yml. A PR that does not touch it runs the base branch's ci.yml (as merged
 * by GitHub), so only PRs that do need the job comparison. Throws when git
 * cannot answer, so the caller fails closed.
 */
export function prTouchesWorkflow(baseSha, headSha, cwd = process.cwd()) {
  const out = git(['diff', '--name-only', '--no-renames', `${baseSha}...${headSha}`, '--', CI_WORKFLOW], cwd);
  return out.trim() !== '';
}

/**
 * Differences between ci.yml at `judgeRef` (base) and the running copy at
 * `runningRef` (the checked-out merge commit), or [] when the PR does not
 * touch ci.yml.
 */
export function workflowDrift({ judgeRef, runningRef, baseSha, headSha, cwd = process.cwd() }) {
  if (!prTouchesWorkflow(baseSha, headSha, cwd)) return [];
  return compareWorkflows(git(['show', `${judgeRef}:${CI_WORKFLOW}`], cwd), git(['show', `${runningRef}:${CI_WORKFLOW}`], cwd));
}
