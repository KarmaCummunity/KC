#!/usr/bin/env node
// Resolve what .github/workflows/deploy.yml deploys, and refuse anything CI
// did not pass.
//
// The deploy runs on `workflow_run` (a CI run, or a version-bump run, on a
// dev/main push finished) or on `workflow_dispatch` from dev/main. Either way
// it judges one exact commit: the triggering run's head SHA, or the
// dispatched ref's SHA — never "whatever the branch tip is by the time a job
// starts". It then requires, via the GitHub API, that:
//   • the commit is still the branch tip — a slower CI run of an older commit
//     must not overwrite a newer deploy (the newer commit's own CI triggers
//     its deploy) — with one exception, the version-bump child below;
//   • a push-event CI run for that commit succeeded with its `CI gate` job
//     successful (a dispatch cannot deploy an ungated commit);
//   • prod only: the commit is the merge commit of a merged dev → main PR of
//     this repository (no direct pushes, no PRs from forks or other branches).
// A workflow_run must also come from ci.yml or the bump workflow of this
// repository; either is only a wake-up call, since certification is always
// read from ci.yml's runs through the API.
//
// Version-bump inheritance (dev only, TD-231). bump-version-on-merge.yml
// pushes a `[skip ci]` commit right after every merge into dev, so the dev tip
// usually has no CI run of its own. Such a commit may deploy on its parent's
// certification when ALL of these hold (bumpCommitErrors): its only changed
// file is app/VERSION, it has exactly one parent, its author or committer is
// the bump workflow's git identity, and its subject is the bump workflow's;
// and the parent has a successful push-event CI run with a green `CI gate` on
// dev or main. The bump commit itself is deployed, so the built
// /version.json carries the new VERSION and the dev tip's SHA. Any other
// shape fails closed: a non-bump tip is "moved on" (skip), an ungated commit
// is refused.
//
// Triggers. A `[skip ci]` commit gets no CI run, so no `workflow_run` ever
// names it. Two triggers cover both orders in which the merge's CI run and
// the bump finish:
//   • CI run of the merge finishes: if the bump child is already the tip,
//     deploy the child (inherited); if not yet, deploy the merge itself.
//   • bump run of the merge finishes: deploy the bump child only if the
//     merge's CI gate is already green (CI finished first and deployed the
//     merge without the bump); otherwise skip, because the CI run's own
//     completion will deploy the child. It never deploys the merge itself, so
//     it cannot duplicate the CI-triggered deploy.
// A duplicate deploy of the child is possible only when CI finishes in the
// seconds between the bump's push and the bump run's completion; deploys are
// idempotent and serialized per environment, so that costs time, not safety.
//
// deploy.yml runs this file from its own commit (github.workflow_sha), never
// from the commit being judged.
//
// Env: EVENT_NAME, REF, SHA (github.sha), WORKFLOW_RUN (toJSON of
// github.event.workflow_run, or empty), GITHUB_REPOSITORY, GITHUB_TOKEN.
// Outputs ($GITHUB_OUTPUT): deploy (true|false), target (dev|prod), branch,
// sha (the commit to deploy: the judged commit or its bump child).

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BRANCH_TARGETS = { dev: 'dev', main: 'prod' };
const GATE_JOB = 'CI gate';

// Workflow files whose finished push runs may wake this resolver, by kind.
export const TRIGGER_WORKFLOWS = {
  '.github/workflows/ci.yml': 'ci',
  '.github/workflows/bump-version-on-merge.yml': 'bump',
};

// The commit bump-version-on-merge.yml creates: the git identity it
// configures (`git config user.name/user.email`), the subject prefix it
// writes (also its own skip marker), and the one file it changes.
export const BUMP_IDENTITY = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };
export const BUMP_SUBJECT = 'chore(release): bump app version';
export const VERSION_FILE = 'app/VERSION';

// Branches whose push CI runs can certify a bump commit's parent.
export const CERTIFYING_BRANCHES = new Set(Object.keys(BRANCH_TARGETS));

/**
 * Branch, judged SHA, target and trigger kind ('ci' | 'bump' | 'dispatch') of
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
    // this; only the two known files may.
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

/**
 * Reasons `commit` (a GET /commits/{sha} payload) is not a commit of
 * bump-version-on-merge.yml; empty means it is one. Shape only — the parent's
 * CI gate is checked separately.
 */
export function bumpCommitErrors(commit) {
  const errors = [];
  const parents = commit?.parents ?? [];
  if (parents.length !== 1) errors.push(`has ${parents.length} parents, not 1`);
  const files = (commit?.files ?? []).map((f) => f.filename);
  if (files.length !== 1 || files[0] !== VERSION_FILE) {
    errors.push(`changes ${files.join(', ') || 'no files'}, not only ${VERSION_FILE}`);
  }
  const isBot = (who) => who?.name === BUMP_IDENTITY.name && who?.email === BUMP_IDENTITY.email;
  const { author, committer, message } = commit?.commit ?? {};
  if (!isBot(author) && !isBot(committer)) {
    errors.push(`author ${author?.email} / committer ${committer?.email} is not the bump workflow (${BUMP_IDENTITY.email})`);
  }
  if (!String(message ?? '').startsWith(BUMP_SUBJECT)) errors.push(`subject does not start with "${BUMP_SUBJECT}"`);
  return errors;
}

/**
 * Inherited certification of a bump commit: { parent, runId } when the
 * commit has the bump shape and its parent has a gated push run on dev or
 * main, else { errors }.
 */
async function inheritedGate(commit, gatedRunOf) {
  const errors = bumpCommitErrors(commit);
  if (errors.length > 0) return { errors };
  const parent = commit.parents[0].sha;
  const runId = await gatedRunOf(parent, CERTIFYING_BRANCHES);
  if (!runId) return { errors: [`parent ${parent} has no successful push CI run with a green "${GATE_JOB}" on dev or main`] };
  return { parent, runId };
}

const skip = (reason) => ({ deploy: false, reason });

/**
 * Decide what to deploy for judged commit `sha`, given the branch `tip`.
 * Returns { deploy: true, sha, runId, inheritedFrom? } (inheritedFrom: the
 * certified parent of a deployed bump commit), { deploy: false, reason }, or
 * throws when a commit that should deploy is not certified. `commitOf(sha)`
 * returns GET /commits/{sha}; `gatedRunOf(sha, branches?)` a gated run id or
 * null.
 */
export async function chooseDeploy({ sha, tip, target, trigger, branch }, { commitOf, gatedRunOf }) {
  const noGate = `no successful push CI run with a green "${GATE_JOB}" for`;
  if (tip === sha) {
    // A bump run whose head is still the tip made no bump commit (or failed
    // to push one); the CI run of the same commit deploys it.
    if (trigger === 'bump') return skip(`${sha} is still the ${branch} tip, so no bump commit followed it; its own CI run deploys it`);
    const runId = await gatedRunOf(sha);
    if (runId) return { deploy: true, sha, runId };
    // E.g. a dispatch while the tip is a bump commit (it never has a CI run).
    if (target !== 'dev') throw new Error(`${noGate} ${sha}; refusing to deploy`);
    const inherited = await inheritedGate(await commitOf(sha), gatedRunOf);
    if (inherited.errors) throw new Error(`${noGate} ${sha}, and it is not a certified version bump (${inherited.errors.join('; ')}); refusing to deploy`);
    return { deploy: true, sha, runId: inherited.runId, inheritedFrom: inherited.parent };
  }
  const movedOn = skip(`${branch} has moved on to ${tip}; skipping ${sha} (the newer commit deploys after its own CI run)`);
  // Bumps land only on dev; on main a newer tip always has its own CI run.
  if (target !== 'dev') return movedOn;
  const child = await commitOf(tip);
  const parents = child?.parents ?? [];
  if (parents.length !== 1 || parents[0].sha !== sha || bumpCommitErrors(child).length > 0) return movedOn;
  const inherited = await inheritedGate(child, gatedRunOf);
  if (!inherited.errors) return { deploy: true, sha: tip, runId: inherited.runId, inheritedFrom: sha };
  // The tip is sha's bump child but sha is not (yet) gated. From the bump
  // trigger that is the normal "CI still running" case: CI's completion
  // deploys the child. From CI or a dispatch it means the gate failed.
  if (trigger === 'bump') return skip(`${sha} has no green "${GATE_JOB}" yet; its CI run's completion deploys bump commit ${tip}`);
  throw new Error(`${noGate} ${sha}, so its version bump ${tip} cannot inherit one; refusing to deploy`);
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
  const { branch, sha, target, trigger } = resolveTarget({
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
    { sha, tip, target, trigger, branch },
    {
      commitOf: (s) => api(`/commits/${s}`),
      gatedRunOf: async (s, branches) =>
        findGatedRun((await api(`/actions/workflows/ci.yml/runs?head_sha=${s}&event=push&per_page=20`)).workflow_runs, jobsOf, branches),
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
  if (decision.inheritedFrom) {
    console.log(
      `::notice::${decision.sha} is the version bump of ${decision.inheritedFrom} (only ${VERSION_FILE} changed, by the bump workflow); ` +
        `its certification is INHERITED from the parent's CI gate in run ${decision.runId}.`,
    );
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
