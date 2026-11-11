#!/usr/bin/env node
// DB schema freeze guard. While the repository variable KC_DB_SCHEMA_FREEZE is
// "true", a change into `dev` that adds, modifies, renames or deletes a file
// under supabase/migrations/, supabase/baseline/ or supabase/schemas/ fails,
// unless its head branch is the cut-over branch. The freeze holds DB changes
// until the production baseline cut-over merges (docs/handoff/CICD-TO-DB-OWNER.md).
//
// Runs on pull_request and merge_group events (ci-static-guards.yml, job
// `freeze`), so it is part of the `static` lane the CI gate aggregates and it
// blocks in the merge queue too. A merge-group run does not know the PR's
// branch name, only `gh-readonly-queue/dev/pr-<N>-<sha>`, so the branch is read
// from the PR through the API (read-only). If it cannot be read, the run fails
// closed.
//
// Lift the freeze: set KC_DB_SCHEMA_FREEZE to anything but "true" (or delete
// it) in Settings > Secrets and variables > Actions > Variables.
//
// Inputs (env): FREEZE, EVENT_NAME, BASE_REF, BASE_SHA, HEAD_SHA, HEAD_REF
// (pull_request: the PR branch; merge_group: the queue ref), HEAD_REPO and
// REPO (pull_request: head and base repository, `owner/name`), GITHUB_TOKEN.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CUTOVER_BRANCH = 'feat/db-baseline-cutover';
export const FROZEN_PATHS = [/^supabase\/migrations\//, /^supabase\/baseline\//, /^supabase\/schemas\//];
export const MESSAGE =
  'DB schema freeze until the production baseline cut-over merges; hold DB changes and land them after the baseline';

export function frozenFiles(files) {
  return files.filter((f) => FROZEN_PATHS.some((re) => re.test(f)));
}

/** PR number from a merge-queue ref such as `refs/heads/gh-readonly-queue/dev/pr-2123-<sha>`. */
export function prNumberFromQueueRef(ref) {
  const m = /gh-readonly-queue\/[^/]+(?:\/[^/]+)*\/pr-(\d+)-[0-9a-f]{7,40}$/.exec(ref ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * Decision from plain values.
 * `branch` is the PR head branch (null = unknown), `sameRepo` is false for a fork PR.
 * Returns { ok, reason, blocked }.
 */
export function decide({ freeze, baseRef, files, branch, sameRepo = true }) {
  if (freeze !== 'true') return { ok: true, reason: 'freeze is off (KC_DB_SCHEMA_FREEZE is not "true")', blocked: [] };
  if (baseRef !== 'dev') return { ok: true, reason: `base is '${baseRef}', the freeze applies only to dev`, blocked: [] };
  const blocked = frozenFiles(files);
  if (blocked.length === 0) return { ok: true, reason: 'no file under supabase/migrations, supabase/baseline or supabase/schemas changed', blocked };
  if (branch === CUTOVER_BRANCH && sameRepo) return { ok: true, reason: `head branch is ${CUTOVER_BRANCH}`, blocked };
  return { ok: false, reason: MESSAGE, blocked };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

async function headBranchFromApi(repo, number, token) {
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GET pulls/${number} -> ${res.status}`);
  const pr = await res.json();
  return { branch: pr.head?.ref ?? null, sameRepo: pr.head?.repo?.full_name === repo };
}

async function main() {
  const env = process.env;
  if (env.FREEZE !== 'true') {
    console.log('DB schema freeze: off (KC_DB_SCHEMA_FREEZE is not "true").');
    return;
  }
  const { EVENT_NAME, BASE_REF, BASE_SHA, HEAD_SHA } = env;
  if (!['pull_request', 'merge_group'].includes(EVENT_NAME)) {
    console.log(`DB schema freeze: not applicable to a ${EVENT_NAME} event.`);
    return;
  }
  if (!BASE_SHA || !HEAD_SHA) throw new Error('BASE_SHA and HEAD_SHA are required');
  const baseRef = (BASE_REF ?? '').replace(/^refs\/heads\//, '');
  // --no-renames: both sides of a rename are listed, so moving a frozen file out of the tree counts.
  const files = git('diff', '--name-only', '--no-renames', `${BASE_SHA}...${HEAD_SHA}`).split('\n').filter(Boolean);

  let branch = null;
  let sameRepo = true;
  // The branch name only matters when a frozen file changed on a change into dev.
  if (baseRef === 'dev' && frozenFiles(files).length > 0) {
    if (EVENT_NAME === 'pull_request') {
      branch = env.HEAD_REF ?? null;
      sameRepo = env.HEAD_REPO === env.REPO;
    } else {
      const number = prNumberFromQueueRef(env.HEAD_REF);
      if (number === null) throw new Error(`cannot read the PR number from merge-queue ref '${env.HEAD_REF}'`);
      ({ branch, sameRepo } = await headBranchFromApi(env.REPO, number, env.GITHUB_TOKEN));
    }
  }

  const result = decide({ freeze: 'true', baseRef, files, branch, sameRepo });
  if (result.ok) {
    console.log(`DB schema freeze: pass (${result.reason}).`);
    return;
  }
  for (const f of result.blocked) console.log(`::error file=${f}::${MESSAGE}`);
  console.error(`::error::${MESSAGE}`);
  console.error(`Frozen files changed (${result.blocked.length}):\n  ${result.blocked.join('\n  ')}`);
  console.error(`Only a PR from the branch '${CUTOVER_BRANCH}' may change them. To lift the freeze, set the repository variable KC_DB_SCHEMA_FREEZE to anything but "true".`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`::error::DB schema freeze check could not run (${err.message}); failing closed.`);
    process.exit(1);
  });
}
