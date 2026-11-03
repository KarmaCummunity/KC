#!/usr/bin/env node
// Trusted CI verdict (INFRA-CI-2): posts the `CI verdict` check that the
// dev/main ruleset requires, from a dedicated GitHub App.
//
// Why: `CI gate` is an ordinary Actions job, and a check run attaches to a
// commit, not a PR. Any workflow an agent pushes on any branch can post a
// green `CI gate` on a commit (for example through a PR from that commit into
// an unprotected branch), and GitHub Actions is the source either way. Only
// .github/workflows/ci-verdict.yml — which runs from the default branch on
// `workflow_run` of CI, with App credentials held in the `ci-verdict`
// environment that only the default branch may use — can post `CI verdict`.
//
// The verdict is per commit SHA, like every check. For each completed PR or
// merge-group run of CI it posts one check on the run's head SHA: success
// only when the run is bound to a PR into dev/main (scripts/ci-run-binding.mjs),
// it is the NEWEST PR-event CI run for that SHA (an older run, or a partial
// re-run of one, can never override a newer red one), all its jobs come from
// the same attempt, the run succeeded and its single `CI gate` job succeeded;
// failure otherwise, including on any error. Push and dispatch runs get no
// verdict: deploy.yml checks its push runs itself, and a dev push run (which
// has no release lane) must not certify the head of a dev → main release PR.
// A release PR's head is the dev tip: no PR into dev can carry that SHA (it
// would have no commits), and its own run's release lane requires head `dev`.
//
// Inputs (env): RUN_ID, HEAD_SHA (the workflow_run's head SHA, so even a
// failed run lookup gets a red verdict), GITHUB_REPOSITORY, GITHUB_TOKEN (App
// installation token: checks write; actions, contents and pull requests read).

import { fileURLToPath } from 'node:url';
import { githubGet, githubList, githubPost } from './ci-github.mjs';
import { PR_EVENTS, attemptErrors, bindPrRun, newestPrRun, runShapeErrors } from './ci-run-binding.mjs';

export const VERDICT_CHECK = 'CI verdict';
export const GATE_JOB = 'CI gate';

/** Events that never get a verdict (see header). */
export const UNCERTIFIED_EVENTS = new Set(['push', 'workflow_dispatch']);

/** Reasons the run's gate job does not certify it (empty = it does). Pure. */
export function gateJobErrors(jobs) {
  const gates = jobs.filter((j) => j.name === GATE_JOB);
  if (gates.length !== 1) return [`run has ${gates.length} "${GATE_JOB}" jobs, expected exactly one`];
  const [gate] = gates;
  if (gate.status !== 'completed' || gate.conclusion !== 'success') {
    return [`"${GATE_JOB}" ended ${gate.conclusion ?? gate.status}`];
  }
  return [];
}

/** Reasons `run` is not the newest PR-event CI run for its head SHA. */
async function newestErrors(run, repo, env) {
  const query = `head_sha=${run.head_sha}&per_page=100`;
  const { workflow_runs: runs } = await githubGet(`/repos/${repo}/actions/workflows/ci.yml/runs?${query}`, env);
  const newest = newestPrRun(runs);
  return newest && newest.id !== run.id ? [`a newer CI run exists for this commit (${newest.html_url}); its verdict decides`] : [];
}

/** Every reason the run must not certify its head SHA (empty = green). */
export async function judgeRun(run, repo, env) {
  const errors = runShapeErrors(run, repo);
  if (errors.length) return errors;
  if (run.conclusion !== 'success') errors.push(`CI run concluded ${run.conclusion}`);
  if (PR_EVENTS.has(run.event)) {
    errors.push(...(await bindPrRun(run, repo, env)).errors);
    errors.push(...(await newestErrors(run, repo, env)));
  }
  const jobs = await githubList(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest`, 'jobs', env);
  return [...errors, ...attemptErrors(run, jobs), ...gateJobErrors(jobs)];
}

/** The check-run payload for a judged head SHA. Pure. */
export function verdictCheck(headSha, runUrl, errors) {
  const ok = errors.length === 0;
  const summary = ok
    ? `CI run ${runUrl} is bound to this commit and its \`${GATE_JOB}\` passed.`
    : ['The CI run for this commit cannot be trusted or did not pass:', ...errors.map((e) => `- ${e}`), '', `Run: ${runUrl ?? 'unknown'}`].join('\n');
  return {
    name: VERDICT_CHECK,
    head_sha: headSha,
    status: 'completed',
    conclusion: ok ? 'success' : 'failure',
    ...(runUrl ? { details_url: runUrl } : {}),
    output: { title: ok ? 'CI passed' : 'CI not certified', summary },
  };
}

/**
 * Judge run RUN_ID and decide what to post: null for an uncertified event,
 * else the check payload. Never throws: any error becomes a red verdict on
 * HEAD_SHA.
 */
export async function decide(env, repo) {
  let run = null;
  let errors;
  try {
    run = await githubGet(`/repos/${repo}/actions/runs/${env.RUN_ID}`, env);
    if (UNCERTIFIED_EVENTS.has(run.event)) return null;
    if (run.head_sha !== env.HEAD_SHA) throw new Error(`run head ${run.head_sha} differs from the event's ${env.HEAD_SHA}`);
    errors = await judgeRun(run, repo, env);
  } catch (err) {
    errors = [`verification failed: ${err.message}`];
  }
  return verdictCheck(env.HEAD_SHA, run?.html_url, errors);
}

async function main() {
  const env = process.env;
  const repo = env.GITHUB_REPOSITORY;
  const check = await decide(env, repo);
  if (!check) {
    console.log(`Run ${env.RUN_ID} is a push or dispatch run: no ${VERDICT_CHECK} is posted.`);
    return;
  }
  await githubPost(`/repos/${repo}/check-runs`, check, env);
  console.log(`${VERDICT_CHECK} on ${check.head_sha}: ${check.conclusion}`);
  if (check.conclusion !== 'success') console.log(check.output.summary);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
