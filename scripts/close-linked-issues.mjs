#!/usr/bin/env node
// Close issues that a PR merged into `dev` says it closes.
//
// Why this exists: GitHub only honors closing keywords ("Closes #N") when a PR
// merges into the DEFAULT branch. KC's default branch is `main`, but every PR
// targets `dev` (see CLAUDE.md §6), so fixed issues stayed open and the project
// board kept showing done work as "Ready" — agents then picked it up again.
// This script applies the same keywords on merges into `dev`.
//
// Modes (run by .github/workflows/close-issues-on-dev-merge.yml):
//   --event                 the merged PR from $GITHUB_EVENT_PATH
//   --since-days N          sweep PRs merged into dev in the last N days
//   --dry-run               print what would close, change nothing
// Needs GITHUB_TOKEN (issues: write) and GITHUB_REPOSITORY.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const KEYWORDS = 'close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved';

// Text inside fenced or inline code is an example, not an instruction.
function stripCode(body) {
  return body.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

/** Issue numbers a PR body closes in `repo`, in order of first mention. */
export function parseClosingRefs(body, repo) {
  if (!body) return [];
  const re = new RegExp(`(?<![\\w-])(?:${KEYWORDS}):?\\s+(?:([\\w.-]+/[\\w.-]+))?#(\\d+)\\b`, 'gi');
  const refs = [];
  for (const m of stripCode(body).matchAll(re)) {
    const sameRepo = !m[1] || m[1].toLowerCase() === repo.toLowerCase();
    const n = Number(m[2]);
    if (sameRepo && !refs.includes(n)) refs.push(n);
  }
  return refs;
}

async function skipReason(n, pr, api) {
  const issue = await api.getIssue(n);
  if (!issue) return 'not found';
  if (issue.pull_request) return 'is a pull request';
  if (issue.state !== 'open') return 'already closed';
  const reopenedAt = await api.lastReopenedAt(n);
  if (reopenedAt && reopenedAt > pr.merged_at) return 'reopened after merge';
  return null;
}

/** Close the open issues `pr` references. Returns { closed, skipped }. */
export async function closeLinkedIssues(pr, repo, api, { dryRun = false } = {}) {
  const result = { closed: [], skipped: [] };
  if (!pr.merged_at) return result;
  const comment =
    `Closed automatically: fixed by #${pr.number}, merged into \`dev\`. ` +
    'It reaches `main` with the next release. Reopen if it still reproduces.';
  for (const n of parseClosingRefs(pr.body, repo)) {
    const reason = await skipReason(n, pr, api);
    if (reason) {
      result.skipped.push({ n, reason });
      continue;
    }
    if (!dryRun) await api.closeIssue(n, comment);
    result.closed.push(n);
  }
  return result;
}

function githubApi(repo, token) {
  const call = async (path, init = {}) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API ${init.method ?? 'GET'} ${path}: ${res.status}`);
    return res.json();
  };
  const send = (path, method, payload) => call(path, { method, body: JSON.stringify(payload) });
  return {
    getIssue: (n) => call(`/issues/${n}`),
    lastReopenedAt: async (n) => {
      const events = (await call(`/issues/${n}/events?per_page=100`)) ?? [];
      const reopened = events.filter((e) => e.event === 'reopened').map((e) => e.created_at);
      return reopened.sort().at(-1) ?? null;
    },
    closeIssue: async (n, comment) => {
      await send(`/issues/${n}/comments`, 'POST', { body: comment });
      await send(`/issues/${n}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
    },
    mergedDevPrsSince: async (sinceIso) => {
      const prs = [];
      for (let page = 1; page <= 10; page++) {
        const batch = await call(`/pulls?state=closed&base=dev&sort=updated&direction=desc&per_page=100&page=${page}`);
        prs.push(...batch.filter((p) => p.merged_at && p.merged_at >= sinceIso));
        if (batch.length < 100 || batch.at(-1).updated_at < sinceIso) break;
      }
      return prs;
    },
  };
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}

async function main(args) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const api = githubApi(repo, token);
  const dryRun = args.includes('--dry-run');
  const sinceDays = argValue(args, '--since-days');
  let prs;
  if (args.includes('--event')) {
    prs = [JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request];
  } else if (sinceDays) {
    prs = await api.mergedDevPrsSince(new Date(Date.now() - Number(sinceDays) * 86_400_000).toISOString());
  } else {
    throw new Error('usage: close-linked-issues.mjs (--event | --since-days N) [--dry-run]');
  }
  for (const pr of prs) {
    const { closed, skipped } = await closeLinkedIssues(pr, repo, api, { dryRun });
    const skippedText = skipped.map((s) => `#${s.n} (${s.reason})`).join(', ') || '-';
    console.log(`PR #${pr.number}: ${dryRun ? 'would close' : 'closed'} ${closed.map((n) => `#${n}`).join(', ') || '-'}; skipped ${skippedText}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
