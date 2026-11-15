#!/usr/bin/env node
// Squash-merge the release PR (dev → main) the only safe way (TD-275, #1876).
//
// Why a script: two traps hit the first baseline release (#2296, 15 Nov 2026).
//   1. GitHub's default squash message lists every squashed commit, and dev
//      carries many `chore(release): bump app version … [skip ci]` commits.
//      A skip token anywhere in the message makes GitHub start NO push
//      workflow on main: no CI, so Deploy (main) never runs (the prod judge,
//      scripts/deploy-target.mjs, needs a push-event CI run of the merge
//      commit), and no sync-main-to-dev.
//   2. The release PR's head branch is `dev`. With the repo setting
//      `delete_branch_on_merge`, GitHub deletes `dev` on merge and retargets
//      every open PR into `dev` onto `main`.
// This script merges with an explicit subject and body that it checks for
// skip tokens, and turns `delete_branch_on_merge` off for the merge, restoring
// the previous value afterwards (also when the merge fails).
//
// Usage: GH_TOKEN=… node scripts/release-merge.mjs <pr> <head-sha> [--dry-run]
// The token must be allowed to merge into main and to edit repo settings.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Commit-message tokens that make GitHub skip push/pull_request workflows. */
export const SKIP_TOKENS = [
  /\[\s*(skip ci|ci skip|no ci|skip actions|actions skip)\s*\]/i,
  /^\s*skip-checks\s*:\s*true\s*$/im,
];

/** The skip tokens found in `text` (empty when it is safe). */
export function skipTokensIn(text) {
  return SKIP_TOKENS.flatMap((re) => {
    const m = String(text ?? '').match(re);
    return m ? [m[0].trim()] : [];
  });
}

export const RELEASE_SUBJECT = 'chore(release): promote dev to main';

/**
 * Subject and body for the squash commit of release PR `number`. The subject
 * is the PR title with ` (#N)`; the body is fixed text, never the commit list.
 * Throws when either would carry a skip token or the title is not a release.
 */
export function releaseSquashMessage({ number, title, headSha }) {
  if (!Number.isInteger(number) || number <= 0) throw new Error(`bad PR number ${number}`);
  if (!String(title ?? '').startsWith(RELEASE_SUBJECT)) {
    throw new Error(`PR title must start with "${RELEASE_SUBJECT}" (got "${title}")`);
  }
  if (!/^[0-9a-f]{40}$/.test(String(headSha ?? ''))) throw new Error(`bad head SHA ${headSha}`);
  const subject = `${title} (#${number})`;
  const body = [
    `Release PR #${number}, dev head ${headSha}.`,
    '',
    'Squashed with an explicit message by scripts/release-merge.mjs: the',
    'commit list of dev is left out on purpose (see docs/db/cutover-runbook.md).',
  ].join('\n');
  const found = skipTokensIn(`${subject}\n${body}`);
  if (found.length) throw new Error(`squash message carries skip token(s): ${found.join(', ')}`);
  return { subject, body };
}

/** Checks on the PR before merging; returns a list of problems. */
export function releasePrProblems(pr, headSha) {
  const problems = [];
  if (pr.state !== 'open') problems.push(`PR is ${pr.state}`);
  if (pr.base?.ref !== 'main') problems.push(`base is ${pr.base?.ref}, not main`);
  if (pr.head?.ref !== 'dev') problems.push(`head is ${pr.head?.ref}, not dev`);
  if (pr.head?.sha !== headSha) problems.push(`head SHA is ${pr.head?.sha}, not ${headSha}`);
  if (pr.mergeable_state !== 'clean') problems.push(`mergeable_state is ${pr.mergeable_state}, not clean`);
  return problems;
}

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });
}
const api = (path, ...rest) => JSON.parse(gh(['api', path, ...rest]) || 'null');

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const [prArg, headSha] = argv.filter((a) => !a.startsWith('--'));
  const repo = process.env.GITHUB_REPOSITORY || 'KarmaCummunity/KC';
  const number = Number(prArg);
  const pr = api(`repos/${repo}/pulls/${number}`);
  const problems = releasePrProblems(pr, headSha);
  const { subject, body } = releaseSquashMessage({ number, title: pr.title, headSha });
  console.log(`subject: ${subject}\n---\n${body}\n---`);
  if (problems.length) throw new Error(`not merging: ${problems.join('; ')}`);
  if (dryRun) return console.log('dry run: not merging');

  const before = api(`repos/${repo}`).delete_branch_on_merge;
  console.log(`delete_branch_on_merge was ${before}`);
  if (before) api(`repos/${repo}`, '-X', 'PATCH', '-F', 'delete_branch_on_merge=false');
  try {
    const payload = JSON.stringify({ merge_method: 'squash', sha: headSha, commit_title: subject, commit_message: body });
    const out = JSON.parse(gh(['api', `repos/${repo}/pulls/${number}/merge`, '-X', 'PUT', '--input', '-'], payload));
    console.log(`merged: ${out.sha}`);
  } finally {
    if (before) api(`repos/${repo}`, '-X', 'PATCH', '-F', 'delete_branch_on_merge=true');
    console.log(`delete_branch_on_merge restored to ${api(`repos/${repo}`).delete_branch_on_merge}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
