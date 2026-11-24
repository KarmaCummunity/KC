#!/usr/bin/env node
// Merge-queue head first on the Android emulator (#2613). The emulator suite runs one at a time
// (ci-maestro-android.yml `concurrency: kc-dev-maestro-emulator, queue: max`), and that queue is
// FIFO by request time, not by merge-queue position. Each merge into dev is followed by a version
// bump commit pushed straight to dev (bump-version-on-merge.yml), which rebuilds every merge group,
// so up to five groups ask for the emulator at once and the queue's head could be served last
// (24 Nov 2026: about 2.5 h per merge).
//
// This runs in its own job, before the emulator job asks for the emulator group, so waiting here
// holds neither the emulator nor a kc-dev slot. A merge_group run waits while any EARLIER entry of
// the merge queue (GraphQL mergeQueue entries, by position) still has Maestro to finish. The head
// goes at once.
//
// Fail-open: any other event, a failed lookup, our entry missing from the queue, or
// KC_QUEUE_TURN_MAX_WAIT_MIN (default 150) reached → go on as before this change. It never exits
// non-zero: the emulator job needs this one.
//
// Env: GITHUB_TOKEN (contents + actions read), GITHUB_REPOSITORY, GITHUB_EVENT_NAME,
// MERGE_GROUP_BASE_REF, MERGE_GROUP_HEAD_SHA.
import { pathToFileURL } from 'node:url';

const EMULATOR = /android emulator/i;
const BUILD = /build E2E APK/i;
const PLAN = /^detect changes$/i;

/** Entries before ours, in queue order; null when our head SHA is not in the queue. */
export function earlierEntries(entries, ownSha) {
  const sorted = [...(entries ?? [])].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((e) => e.headCommit?.oid === ownSha);
  return i < 0 ? null : sorted.slice(0, i);
}

/** Why an earlier entry's CI run still has Maestro to finish, or null. */
export function blockReason(run, jobs) {
  if (!run || run.status === 'completed') return null;
  const list = jobs ?? [];
  const emu = list.find((j) => EMULATOR.test(j.name));
  if (emu) return emu.status === 'completed' ? null : `emulator ${emu.status}`;
  const build = list.find((j) => BUILD.test(j.name));
  if (build) {
    if (build.status !== 'completed') return 'Maestro planned, APK building';
    return build.conclusion === 'success' ? 'Maestro planned, emulator not started' : null;
  }
  const plan = list.find((j) => PLAN.test(j.name));
  if (plan && plan.status !== 'completed') return 'lanes not planned yet';
  return null;
}

export async function readEntries(gql, repo, baseRef) {
  const [owner, name] = repo.split('/');
  const branch = String(baseRef).replace(/^refs\/heads\//, '');
  const q = `query($o:String!,$n:String!,$b:String!){repository(owner:$o,name:$n){mergeQueue(branch:$b){entries(first:100){nodes{position state headCommit{oid} pullRequest{number}}}}}}`;
  const d = await gql(q, { o: owner, n: name, b: branch });
  const nodes = d?.repository?.mergeQueue?.entries?.nodes;
  if (!Array.isArray(nodes)) throw new Error('no mergeQueue entries in the response');
  return nodes;
}

/** First earlier entry that blocks us, checked from the head down: { entry, reason } or null. */
export async function firstBlocker(gh, repo, earlier) {
  for (const entry of earlier) {
    const sha = entry.headCommit?.oid;
    if (!sha) continue;
    const runs = await gh(`/repos/${repo}/actions/workflows/ci.yml/runs?event=merge_group&head_sha=${sha}&per_page=5`);
    const run = (runs.workflow_runs ?? []).sort((a, b) => b.id - a.id)[0];
    if (!run || run.status === 'completed') continue;
    const { jobs } = await gh(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
    const reason = blockReason(run, jobs);
    if (reason) return { entry, reason, run };
  }
  return null;
}

async function main(env = process.env) {
  if (env.GITHUB_EVENT_NAME !== 'merge_group') return console.log(`queue turn: ${env.GITHUB_EVENT_NAME} run, nothing to wait for`);
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  const own = env.MERGE_GROUP_HEAD_SHA;
  if (!token || !repo || !own || !env.MERGE_GROUP_BASE_REF) return console.log('::warning::queue turn: missing token/repo/merge group; going on (fail-open)');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  const gh = async (path) => {
    const res = await fetch(`https://api.github.com${path}`, { headers });
    if (!res.ok) throw new Error(`GET ${path.split('?')[0]} → ${res.status}`);
    return res.json();
  };
  const gql = async (query, variables) => {
    const res = await fetch('https://api.github.com/graphql', { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.errors?.length) throw new Error(`GraphQL ${res.status}: ${(body.errors ?? []).map((e) => e.message).join('; ')}`);
    return body.data;
  };
  const pollMs = Number(env.KC_QUEUE_TURN_POLL_MS) || 90_000;
  const maxMin = Number(env.KC_QUEUE_TURN_MAX_WAIT_MIN) || 150;
  const start = Date.now();
  let last = '';
  for (;;) {
    let earlier, blocker;
    try {
      earlier = earlierEntries(await readEntries(gql, repo, env.MERGE_GROUP_BASE_REF), own);
      if (earlier === null) return console.log(`queue turn: ${own.slice(0, 8)} is not in the merge queue (obsolete or already merging); going on`);
      blocker = await firstBlocker(gh, repo, earlier);
    } catch (e) {
      return console.log(`::warning::queue turn: lookup failed (${e.message}); going on as before (fail-open)`);
    }
    const waited = Math.round((Date.now() - start) / 60000);
    if (!blocker) return console.log(`queue turn: go at position ${earlier.length + 1} after ${waited} min — no earlier entry has Maestro left`);
    const line = `queue turn: position ${earlier.length + 1} waits for #${blocker.entry.pullRequest?.number} (position ${blocker.entry.position}, run ${blocker.run.id}): ${blocker.reason}`;
    if (line !== last) console.log(`${new Date().toISOString()} ${line}`);
    last = line;
    if (waited >= maxMin) return console.log(`::warning::queue turn: waited ${waited} min; going on (KC_QUEUE_TURN_MAX_WAIT_MIN)`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => console.log(`::warning::queue turn: ${e.message}; going on (fail-open)`));
}
