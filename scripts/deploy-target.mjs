#!/usr/bin/env node
// Resolve what .github/workflows/deploy.yml deploys, and refuse anything CI
// did not pass.
//
// The deploy runs on `workflow_run` (a CI run on a dev/main push finished), on
// a dev push, or on `workflow_dispatch` from dev/main. Either way it judges one
// exact commit: the triggering run's head SHA, or the pushed/dispatched SHA —
// never "whatever the branch tip is by the time a job starts". It then
// requires, via the GitHub API, that:
//   • the commit is still the branch tip — a slower CI run of an older commit
//     must not overwrite a newer deploy (the newer commit's own CI triggers
//     its deploy);
//   • a push-event CI run for that commit succeeded with its `CI gate` job
//     successful (a dispatch cannot deploy an ungated commit);
//   • prod only: the commit is the merge commit of a merged dev → main PR of
//     this repository (no direct pushes, no PRs from forks or other branches).
// A workflow_run must also come from ci.yml of this repository; it is only a
// wake-up call, since certification is always read from ci.yml's runs through
// the API.
//
// Until 24 Nov 2026 a `[skip ci]` version-bump commit followed every merge into
// dev and deployed on its parent's certification (TD-231). The version is now
// bumped only for a release or a store build (#2613: each bump pushed to dev
// rebuilt every merge group), so every dev commit has its own CI run and no
// inheritance is left. A tip without a gated CI run of its own is refused.
//
// deploy.yml runs this file from its own commit (github.workflow_sha), never
// from the commit being judged.
//
// Env: EVENT_NAME, REF, SHA (github.sha), WORKFLOW_RUN (toJSON of
// github.event.workflow_run, or empty), GITHUB_REPOSITORY, GITHUB_TOKEN.
// Outputs ($GITHUB_OUTPUT): deploy (true|false), target (dev|prod), branch,
// sha (the commit to deploy).

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BRANCH_TARGETS = { dev: 'dev', main: 'prod' };
const GATE_JOB = 'CI gate';

// Workflow files whose finished push runs may wake this resolver, by kind.
export const TRIGGER_WORKFLOWS = {
  '.github/workflows/ci.yml': 'ci',
};

/**
 * Branch, judged SHA, target and trigger kind ('ci' | 'dispatch') of
 * this deploy, or throw when the event cannot deploy.
 */
export function resolveTarget({ event, ref, sha, workflowRun, repo }) {
  let branch;
  let trigger = 'dispatch';
  if (event === 'workflow_run') {
    if (workflowRun?.event !== 'push' || workflowRun?.conclusion !== 'success') {
      throw new Error(`CI run was a ${workflowRun?.event} event ending ${workflowRun?.conclusion}; only successful pushes deploy`);
    }
    if (workflowRun.head_repository?.full_name !== repo) {
      throw new Error(`CI run came from ${workflowRun.head_repository?.full_name}, not ${repo}`);
    }
    // Matched by name in deploy.yml, so a look-alike workflow could trigger
    // this; only ci.yml may.
    trigger = TRIGGER_WORKFLOWS[workflowRun.path];
    if (!trigger) throw new Error(`run of ${workflowRun.path} cannot trigger a deploy (only ${Object.keys(TRIGGER_WORKFLOWS).join(', ')})`);
    branch = workflowRun.head_branch;
    sha = workflowRun.head_sha;
  } else if (event === 'workflow_dispatch') {
    branch = ref?.replace(/^refs\/heads\//, '');
  } else if (event === 'push') {
    // dev only (#1430): judged like a dispatch of the pushed SHA.
    if (ref !== 'refs/heads/dev') throw new Error(`only dev deploys on push (got ${ref})`);
    branch = 'dev';
  } else {
    throw new Error(`deploy cannot run on ${event}`);
  }
  const target = Object.hasOwn(BRANCH_TARGETS, branch) && ref?.startsWith('refs/heads/') ? BRANCH_TARGETS[branch] : null;
  if (!target) throw new Error(`only dev and main deploy (got ${branch ?? ref})`);
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error(`not a commit SHA: ${sha}`);
  return { branch, sha, target, trigger };
}

/**
 * Id of a successful push-event CI run whose `CI gate` job succeeded, or null.
 * `runs` are CI runs for the SHA; `jobsOf(id)` resolves a run's jobs. With
 * `branches`, only runs on one of those branches count.
 */
export async function findGatedRun(runs, jobsOf, branches = null) {
  for (const run of runs) {
    if (run.event !== 'push' || run.conclusion !== 'success') continue;
    if (branches && !branches.has(run.head_branch)) continue;
    const jobs = await jobsOf(run.id);
    if (jobs.some((j) => j.name === GATE_JOB && j.conclusion === 'success')) return run.id;
  }
  return null;
}

const skip = (reason) => ({ deploy: false, reason });

/**
 * Decide what to deploy for judged commit `sha`, given the branch `tip`.
 * Returns { deploy: true, sha, runId }, { deploy: false, reason } when the
 * branch has moved on, or throws when the tip is not certified.
 * `gatedRunOf(sha)` returns a gated run id or null.
 */
export async function chooseDeploy({ sha, tip, branch }, { gatedRunOf }) {
  if (tip !== sha) return skip(`${branch} has moved on to ${tip}; skipping ${sha} (the newer commit deploys after its own CI run)`);
  const runId = await gatedRunOf(sha);
  if (!runId) throw new Error(`no successful push CI run with a green "${GATE_JOB}" for ${sha}; refusing to deploy`);
  return { deploy: true, sha, runId };
}

/** Number of the merged dev → main PR of `repo` whose merge commit is `sha`, or null. */
export function findReleasePr(pulls, { repo, sha }) {
  const pr = pulls.find(
    (p) =>
      p.merged_at &&
      p.merge_commit_sha === sha &&
      p.base?.ref === 'main' &&
      p.base?.repo?.full_name === repo &&
      p.head?.ref === 'dev' &&
      p.head?.repo?.full_name === repo,
  );
  return pr?.number ?? null;
}

function githubApi(token, repo) {
  return async (path) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub API ${path} → HTTP ${res.status}`);
    return res.json();
  };
}

function emit(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

async function main() {
  const env = process.env;
  const { branch, sha, target } = resolveTarget({
    event: env.EVENT_NAME,
    ref: env.REF,
    sha: env.SHA,
    workflowRun: env.WORKFLOW_RUN && env.WORKFLOW_RUN !== 'null' ? JSON.parse(env.WORKFLOW_RUN) : null,
    repo: env.GITHUB_REPOSITORY,
  });
  const api = githubApi(env.GITHUB_TOKEN, env.GITHUB_REPOSITORY);
  const tip = (await api(`/branches/${branch}`)).commit.sha;
  const jobsOf = async (id) => (await api(`/actions/runs/${id}/jobs?per_page=100`)).jobs;
  const decision = await chooseDeploy(
    { sha, tip, branch },
    {
      gatedRunOf: async (s) =>
        findGatedRun((await api(`/actions/workflows/ci.yml/runs?head_sha=${s}&event=push&per_page=20`)).workflow_runs, jobsOf),
    },
  );
  if (!decision.deploy) {
    console.log(`::notice::${decision.reason}`);
    emit({ deploy: false, target, branch, sha });
    return;
  }
  if (target === 'prod') {
    const pr = findReleasePr(await api(`/commits/${decision.sha}/pulls`), { repo: env.GITHUB_REPOSITORY, sha: decision.sha });
    if (!pr) throw new Error(`${decision.sha} is not the merge commit of a merged dev → main PR of this repository; refusing to deploy prod`);
    console.log(`Release PR #${pr}.`);
  }
  console.log(`CI gate passed in run ${decision.runId}; deploying ${decision.sha} on ${branch} → ${target}.`);
  emit({ deploy: true, target, branch, sha: decision.sha });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.log(`::error::${err.message}`);
    process.exit(1);
  });
}
