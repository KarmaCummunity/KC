// Identifies the one pull request a merge-queue run tests (D-195, INFRA-CI-2,
// TD-252). Like the other CI judge modules it runs from the BASE commit's copy
// of scripts/, so a PR cannot change how its own queue run is attributed.
//
// GitHub's merge queue builds every entry on top of the entry ahead of it, on a
// branch named `gh-readonly-queue/<base>/pr-<N>-<parent sha>` that holds ONE
// squash commit whose subject ends in `(#N)`. For such a run the `merge_group`
// payload's base_sha is that parent, so BASE_SHA..HEAD_SHA is exactly the
// entry's own change, and the owner approval of PR N can judge it. The merge
// group payload comes only from GitHub's queue; a pushed branch of the same
// name raises a `push` event instead.
//
// Every assumption below is checked, and any mismatch yields no PR (and so no
// owner override): the gate then stays red, never green.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** `refs/heads/gh-readonly-queue/<base branch>/pr-<N>-<40-hex parent sha>`. */
const QUEUE_REF = /^refs\/heads\/gh-readonly-queue\/(.+)\/pr-(\d+)-([0-9a-f]{40})$/;

/** The `(#N)` GitHub appends to the subject of a squash commit. */
const SQUASH_NUMBER = /\(#(\d+)\)\s*$/;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Split a merge-queue ref into its parts, or null when it is not one.
 * @param {string | null | undefined} ref
 * @returns {{ baseBranch: string, number: number, parentSha: string } | null}
 */
export function parseQueueRef(ref) {
  const match = QUEUE_REF.exec(ref ?? '');
  return match ? { baseBranch: match[1], number: Number(match[2]), parentSha: match[3] } : null;
}

/**
 * The merge group's head ref. `HEAD_REF` (tests, manual runs) wins; otherwise it
 * is read from the event payload file GitHub gives every step, so the workflow
 * files need no extra input. Null when neither is available.
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function readQueueHeadRef(env) {
  if (env.HEAD_REF) return env.HEAD_REF;
  if (!env.GITHUB_EVENT_PATH) return null;
  try {
    return JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).merge_group?.head_ref ?? null;
  } catch {
    return null;
  }
}

/**
 * Work out which PR a merge-group run tests. Returns { number, baseBranch }, or
 * { why } naming the first assumption that does not hold. Requires:
 *  1. the head ref is a merge-queue branch;
 *  2. its parent sha is the run's base commit, so the group is stacked directly
 *     on BASE_SHA;
 *  3. BASE_SHA..HEAD_SHA is exactly one commit, whose only parent is BASE_SHA;
 *  4. that commit's subject ends in the same `(#N)` as the branch name.
 * Throws when git cannot answer; the caller turns that into a red gate.
 * @param {{ headRef: string | null, baseSha: string, headSha: string }} run
 * @param {string} [cwd]
 * @returns {{ number: number, baseBranch: string } | { why: string }}
 */
export function identifyQueuedPr({ headRef, baseSha, headSha }, cwd = process.cwd()) {
  const ref = parseQueueRef(headRef);
  if (!ref) return { why: `head ref "${headRef}" is not a merge-queue branch` };
  if (ref.parentSha !== baseSha) return { why: 'the queue branch is not built directly on the run\'s base commit' };
  const commits = git(['rev-list', '--parents', `${baseSha}..${headSha}`], cwd).split('\n').filter(Boolean);
  if (commits.length !== 1 || commits[0] !== `${headSha} ${baseSha}`) {
    return { why: `the merge group does not add exactly one commit on its base (found ${commits.length})` };
  }
  const named = SQUASH_NUMBER.exec(git(['log', '-1', '--format=%s', headSha], cwd).trim());
  if (!named || Number(named[1]) !== ref.number) {
    return { why: `the group's commit does not carry the (#${ref.number}) of its queue branch` };
  }
  return { number: ref.number, baseBranch: ref.baseBranch };
}
