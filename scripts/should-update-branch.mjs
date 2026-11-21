#!/usr/bin/env node
// Decides whether a PR into dev should get a "Merge branch 'dev'" update now. Read-only: it never
// updates a branch itself; the merger calls PUT /pulls/{n}/update-branch only on `update`.
//
// Why: on 21 Nov 2026 an outside sweep updated every auto-merge PR that was behind dev about every
// 1.5 h. Each update cancelled the PR's in-flight CI, including Maestro jobs that had waited up to an
// hour for the single kc-dev test slot (#1619). The updates stay wanted (Nave, 21 Nov); this makes
// them skip when they would only cost a run. The merge queue tests every PR on the newest dev anyway
// (dev ruleset: merge queue, strict=false), so skipping an update never lets a broken merge through.
//
// Rule, in order (first match wins):
//   1. skip `closed` / `draft`: not open, or a draft.
//   2. skip `up-to-date`: dev has no commits the PR's head lacks.
//   3. skip `ci-in-flight`: a workflow run for the head commit is queued, waiting, pending or in
//      progress (Maestro waiting for a slot included). Try again next cycle.
//   4. skip `conflict`: GitHub says the PR conflicts with dev (mergeable_state "dirty"); an update
//      cannot merge it, the author has to resolve it.
//   5. update `overlap`: a file the PR changes was also changed on dev since the merge base, or both
//      touch the same unit (UNITS: e.g. two new migrations can collide on a number without sharing a
//      path, and a lock file goes with its package.json).
//   6. update `stale`: the PR is more than MAX_BEHIND (default 300) commits behind, so its CI result
//      says little about today's dev.
//   7. skip `no-overlap`: otherwise. The dev changes do not touch anything the PR touches.
//
// Usage: GITHUB_TOKEN=… node scripts/should-update-branch.mjs <pr-number>... | --all [--max-behind N]
// Prints one JSON line per PR: { pr, decision: "update"|"skip", reason, behindBy, overlap?, overlapCount? }.
// Exit 0 always on a decision; 2 on usage/API errors (the merger should then skip this cycle).
import { pathToFileURL } from 'node:url';

export const UNITS = [
  ['supabase/migrations/', 'supabase/schemas/', 'supabase/baseline/'],
  ['app/package.json', 'app/package-lock.json'],
  ['scripts/package.json', 'scripts/package-lock.json'],
  ['package.json', 'package-lock.json'],
];
export const MAX_BEHIND = 300;
const IN_FLIGHT = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

/** The unit index a path belongs to, or -1. Directory units end with "/" and match by prefix. */
export function unitOf(path) {
  return UNITS.findIndex((u) => u.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p)));
}

/** Paths (or "unit:<first entry>") that both lists touch. */
export function overlapping(prFiles, devFiles) {
  const dev = new Set(devFiles);
  const devUnits = new Set(devFiles.map(unitOf).filter((u) => u >= 0));
  const out = new Set();
  for (const f of prFiles) {
    if (dev.has(f)) out.add(f);
    else if (devUnits.has(unitOf(f)) && unitOf(f) >= 0) out.add(`unit:${UNITS[unitOf(f)][0]}`);
  }
  return [...out];
}

/**
 * Pure decision. `pr` = { state, draft, mergeable_state }; `behindBy` = dev commits the head lacks;
 * `runStatuses` = statuses of the workflow runs for the head commit; `prFiles` / `devFiles` = paths
 * the PR changes and dev changed since the merge base.
 */
export function decideUpdate({ pr, behindBy, runStatuses, prFiles, devFiles, maxBehind = MAX_BEHIND }) {
  if (pr.state !== 'open') return { decision: 'skip', reason: 'closed' };
  if (pr.draft) return { decision: 'skip', reason: 'draft' };
  if (behindBy === 0) return { decision: 'skip', reason: 'up-to-date', behindBy };
  if (runStatuses.some((s) => IN_FLIGHT.has(s))) return { decision: 'skip', reason: 'ci-in-flight', behindBy };
  if (pr.mergeable_state === 'dirty') return { decision: 'skip', reason: 'conflict', behindBy };
  const overlap = overlapping(prFiles, devFiles);
  if (overlap.length > 0) return { decision: 'update', reason: 'overlap', behindBy, overlap };
  if (behindBy > maxBehind) return { decision: 'update', reason: 'stale', behindBy };
  return { decision: 'skip', reason: 'no-overlap', behindBy };
}

async function gh(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

async function paged(path, token, key) {
  const out = [];
  for (let page = 1; page <= 30; page += 1) {
    const d = await gh(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token);
    const items = key ? (d[key] ?? []) : d;
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

export async function evaluate(repo, token, number, maxBehind = MAX_BEHIND) {
  const pr = await gh(`/repos/${repo}/pulls/${number}`, token);
  const base = pr.base.ref;
  const cmp = await gh(`/repos/${repo}/compare/${encodeURIComponent(pr.head.sha)}...${encodeURIComponent(base)}`, token);
  const behindBy = cmp.ahead_by; // commits on dev the head lacks
  const runs = await gh(`/repos/${repo}/actions/runs?head_sha=${pr.head.sha}&per_page=100`, token);
  const prFiles = (await paged(`/repos/${repo}/pulls/${number}/files`, token)).map((f) => f.filename);
  // Compare lists at most 300 files; beyond that treat it as touching everything the PR does.
  const devFiles = (cmp.files ?? []).map((f) => f.filename);
  const truncated = (cmp.files ?? []).length >= 300;
  const r = decideUpdate({
    pr,
    behindBy,
    runStatuses: (runs.workflow_runs ?? []).map((x) => x.status),
    prFiles,
    devFiles: truncated ? [...devFiles, ...prFiles] : devFiles,
    maxBehind,
  });
  // Keep the line short: the first 10 overlapping paths and the count.
  if (r.overlap) return { pr: number, ...r, overlapCount: r.overlap.length, overlap: r.overlap.slice(0, 10) };
  return { pr: number, ...r };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  const repo = env.GITHUB_REPOSITORY || 'KarmaCummunity/KC';
  const mb = argv.indexOf('--max-behind');
  const maxBehind = mb >= 0 ? Number(argv[mb + 1]) : MAX_BEHIND;
  const args = argv.filter((a, i) => !(mb >= 0 && (i === mb || i === mb + 1)));
  if (!token || args.length === 0) {
    console.error('usage: GITHUB_TOKEN=… node scripts/should-update-branch.mjs <pr>... | --all [--max-behind N]');
    process.exit(2);
  }
  let numbers = args.filter((a) => /^\d+$/.test(a)).map(Number);
  if (args.includes('--all')) numbers = (await paged(`/repos/${repo}/pulls?state=open&base=dev`, token)).map((p) => p.number);
  let failed = false;
  for (const n of numbers) {
    try {
      console.log(JSON.stringify(await evaluate(repo, token, n, maxBehind)));
    } catch (err) {
      failed = true;
      console.log(JSON.stringify({ pr: n, decision: 'skip', reason: 'api-error', error: err.message }));
    }
  }
  if (failed) process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
