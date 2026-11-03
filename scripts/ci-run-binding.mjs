// Binds a finished run of ci.yml to the change it judged (INFRA-CI-2).
//
// A check run attaches to a commit SHA, not to a PR. Any workflow on any
// branch can post a check named `CI gate` on a commit, e.g. a PR from that
// commit into an unprotected branch whose own ci.yml exits 0. So neither the
// trusted verdict (scripts/ci-verdict.mjs) nor a review-triggered gate that
// reuses lane results (scripts/ci-run-reuse.mjs) may trust a run until it is
// proven to be:
//   • a run of this repository's .github/workflows/ci.yml, on a same-repo head;
//   • for PR events, a run of PR #N into dev or main:
//       – EVERY reusable-workflow reference the run records is a workflow of
//         this repository at refs/pull/N/merge, all at one merge commit (a
//         remote-form call to another PR's merge ref is recorded like a local
//         one, so this alone is not proof — hence the next checks);
//       – PR #N's head is this run's head branch and head SHA, and no PR from
//         that branch with that head SHA (open or closed) targets any other
//         base — so a PR from the same commit into an attacker's branch,
//         whose own ci.yml could fake the gate, makes the commit unprovable;
//       – the merge commit's second parent is the head SHA and its first
//         parent is already part of the base branch's tip with no gate file
//         (.github/**, scripts/ci-*, scripts/check-*) changed since, so the
//         workflow and judges that ran are the base branch's own;
//   • for merge groups: a queue branch of dev or main; for pushes and
//     dispatches: dev or main itself. ci-verdict.mjs never certifies pushes or
//     dispatches (deploy.yml checks its push runs itself).
// Every failure is reported as a reason; callers fail closed.

import { githubGet, githubList } from './ci-github.mjs';

export const CI_PATH = '.github/workflows/ci.yml';
export const PROTECTED = new Set(['dev', 'main']);
export const PR_EVENTS = new Set(['pull_request', 'pull_request_review']);
const GATE_FILES = [/^\.github\//, /^scripts\/ci-/, /^scripts\/check-/];
const QUEUE_BRANCH = /^gh-readonly-queue\/(dev|main)\//;

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/** Reasons a run's own fields rule it out (empty = plausible). Pure. */
export function runShapeErrors(run, repo) {
  const errors = [];
  if (run.path !== CI_PATH) errors.push(`workflow file is ${run.path}, not ${CI_PATH}`);
  if (!same(run.repository?.full_name, repo)) errors.push('run belongs to another repository');
  if (!same(run.head_repository?.full_name, repo)) errors.push('run head is not a branch of this repository (fork)');
  if (run.status !== 'completed') errors.push(`run is ${run.status}, not completed`);
  if (PR_EVENTS.has(run.event)) return errors;
  if (run.event === 'merge_group' && !QUEUE_BRANCH.test(run.head_branch ?? '')) {
    errors.push(`merge group branch ${run.head_branch} is not a dev/main queue branch`);
  } else if (['push', 'workflow_dispatch'].includes(run.event) && !PROTECTED.has(run.head_branch)) {
    errors.push(`${run.event} run on ${run.head_branch}, not dev or main`);
  } else if (!['merge_group', 'push', 'workflow_dispatch'].includes(run.event)) {
    errors.push(`event ${run.event} is not judged`);
  }
  return errors;
}

/**
 * The merge commit and PR number a PR-event run executed, or null unless
 * EVERY reusable-workflow reference is `<repo>/.github/workflows/<file>@refs/pull/N/merge`
 * with that same ref and one merge commit SHA. Pure.
 */
export function mergeRefOf(run, repo) {
  const refs = run.referenced_workflows ?? [];
  if (refs.length === 0) return null;
  const pathRe = /^([^/]+\/[^/]+)\/\.github\/workflows\/[^/@]+\.ya?ml@(refs\/pull\/(\d+)\/merge)$/;
  const parsed = refs.map((w) => ({ m: pathRe.exec(w.path ?? ''), w }));
  const ok = parsed.every(({ m, w }) => m && same(m[1], repo) && w.ref === m[2] && w.sha === refs[0].sha && w.ref === refs[0].ref);
  if (!ok || !refs[0].sha) return null;
  return { sha: refs[0].sha, pr: Number(parsed[0].m[3]) };
}

/** Gate files among a compare's changed files. Pure. */
export function gateFilesChanged(files) {
  return files.map((f) => f.filename).filter((name) => GATE_FILES.some((re) => re.test(name)));
}

/** Reasons PR #N (the API object) is not the PR this run built. Pure. */
export function prMismatchErrors(pr, run, repo, expect = {}) {
  const n = `PR #${pr.number}`;
  const errors = [];
  if (!same(pr.base?.repo?.full_name, repo)) errors.push(`${n} targets another repository`);
  if (!PROTECTED.has(pr.base?.ref)) errors.push(`${n} targets ${pr.base?.ref}, not dev or main`);
  if (expect.baseRef !== undefined && pr.base?.ref !== expect.baseRef) errors.push(`${n} targets ${pr.base?.ref}, not ${expect.baseRef}`);
  if (!same(pr.head?.repo?.full_name, repo)) errors.push(`${n} comes from another repository`);
  if (pr.head?.ref !== run.head_branch) errors.push(`${n} head branch is ${pr.head?.ref}, but the run built ${run.head_branch}`);
  if (pr.head?.sha !== run.head_sha) errors.push(`${n} head is ${pr.head?.sha}, but the run built ${run.head_sha}`);
  return errors;
}

/**
 * Reasons the run's head commit is also proposed elsewhere: any PR from the
 * same branch with the same head SHA (open or closed) whose base is not
 * dev/main of this repository. Pure.
 */
export function siblingPrErrors(prs, run, repo) {
  return prs
    .filter((p) => p.head?.sha === run.head_sha)
    .filter((p) => !PROTECTED.has(p.base?.ref) || !same(p.base?.repo?.full_name, repo))
    .map((p) => `PR #${p.number} also proposes ${run.head_sha} into ${p.base?.ref}; a run of that PR could fake the gate`);
}

/**
 * Prove a completed PR-event run belongs to a PR into dev/main (see header).
 * `expect.pr` / `expect.baseRef` additionally pin the PR number and base.
 * Returns { errors, pr } — `pr` is the bound PR object when errors is empty.
 */
export async function bindPrRun(run, repo, env, expect = {}) {
  const merge = mergeRefOf(run, repo);
  if (!merge) return { errors: ['run references workflows other than this repository at one refs/pull/N/merge commit'] };
  if (expect.pr !== undefined && merge.pr !== expect.pr) return { errors: [`run judged PR #${merge.pr}, not PR #${expect.pr}`] };
  const pr = await githubGet(`/repos/${repo}/pulls/${merge.pr}`, env);
  const mismatch = prMismatchErrors(pr, run, repo, expect);
  if (mismatch.length) return { errors: mismatch };
  const owner = repo.split('/')[0];
  const siblings = await githubList(`/repos/${repo}/pulls?state=all&head=${owner}:${encodeURIComponent(run.head_branch)}`, null, env);
  const elsewhere = siblingPrErrors(siblings, run, repo);
  if (elsewhere.length) return { errors: elsewhere };
  const commit = await githubGet(`/repos/${repo}/commits/${merge.sha}`, env);
  const parents = commit.parents?.map((p) => p.sha) ?? [];
  if (parents.length !== 2 || parents[1] !== run.head_sha) return { errors: [`merge commit ${merge.sha} does not merge head ${run.head_sha}`] };
  // Resolve the branch tip by the branches API: a tag named like the branch
  // cannot stand in for it.
  const tip = (await githubGet(`/repos/${repo}/branches/${pr.base.ref}`, env)).commit?.sha;
  const cmp = await githubGet(`/repos/${repo}/compare/${parents[0]}...${tip}`, env);
  if (!['ahead', 'identical'].includes(cmp.status)) {
    return { errors: [`the run's base ${parents[0]} is not part of ${pr.base.ref} (${cmp.status})`] };
  }
  if ((cmp.files?.length ?? 0) >= 300) return { errors: [`${pr.base.ref} moved too far since the run to verify; re-run CI`] };
  const moved = gateFilesChanged(cmp.files ?? []);
  if (moved.length) return { errors: [`${pr.base.ref} changed gate files since the run (${moved.join(', ')}); re-run CI`] };
  return { errors: [], pr };
}

/**
 * Reasons a run's jobs mix attempts (empty = all from `run.run_attempt`). A
 * "Re-run failed jobs" attempt keeps older jobs' results, e.g. a `static`
 * success from before an approval was withdrawn, so only full attempts count.
 * Pure.
 */
export function attemptErrors(run, jobs) {
  const stale = jobs.filter((j) => j.run_attempt !== run.run_attempt).map((j) => j.name);
  return stale.length ? [`jobs from an earlier attempt (${stale.join(', ')}); use "Re-run all jobs"`] : [];
}

/** The newest-created PR-event run among `runs`, or null. Pure. */
export function newestPrRun(runs) {
  const prRuns = runs.filter((r) => PR_EVENTS.has(r.event));
  prRuns.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  return prRuns[0] ?? null;
}
