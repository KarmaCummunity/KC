#!/usr/bin/env node
// Waits for a free "kc-dev test slot" before a job starts its tests against the shared kc-dev
// project. kc-dev is a Free/Nano Supabase project: on 13 and 14 Nov 2026 five Maestro emulators
// plus two Playwright suites ran at once and the whole instance stalled (cron runs 10–50 s,
// Auth 504, PostgREST 57014, pooler connect timeouts), which turned Deploy, E2E and every app
// PR's Maestro lane red. GitHub `concurrency` cannot queue them: it keeps one pending run and
// cancels the rest, and a cancelled Maestro lane fails the PR's CI gate.
//
// A slot is held by any in-progress job of this repository that has a step named SLOT_STEP
// which has completed (it got through) — until that job ends. Jobs still waiting are ordered
// FIFO by the start time of their SLOT_STEP (then job id). This job proceeds when the holders
// plus the waiters ahead of it are fewer than KC_DEV_TEST_SLOTS (default 2).
// After KC_DEV_SLOT_MAX_WAIT_MIN (default 120) it proceeds with a warning, so a stuck throttle
// cannot block CI forever. A GitHub API error (a 403/429 rate limit, a 5xx) is NOT a free pass: it
// waits (honouring Retry-After / X-RateLimit-Reset, capped) and asks again. Until 15 Nov 2026 any error
// let the job through: at 10:18Z seven queued Maestro jobs got the same 403 within 26 s and all went at
// once, so nine emulators plus a release E2E hit kc-dev together and it stalled for hours.
// A run that replaces a cancelled one keeps the cancelled run's place in the queue (queuedAt, below):
// until 21 Nov 2026 a superseded PR run (a new push, an update-branch merge, a cancel + re-run) went to
// the back of the line, so a PR that was updated while it waited could wait 120 min more, again and
// again (#1619: from 19 to 21 Nov 34 waiting jobs were cancelled after a median 64 min in the queue,
// 30.7 h in all; #2578 had been queued since 15:12Z when its third run was cancelled at 17:38Z).
// To keep the API cost low (the repository's GITHUB_TOKEN budget is shared by every waiter), it polls
// every KC_DEV_SLOT_POLL_MS (default 60 s) and reads the jobs only of runs whose workflow can hold a
// slot (slotWorkflows: the workflows that run this script, and those that call them).
//
// Needs GITHUB_TOKEN with `actions: read`. Env: GITHUB_REPOSITORY, GITHUB_RUN_ID,
// GITHUB_RUN_ATTEMPT, RUNNER_NAME (set by Actions).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SLOT_STEP = 'Wait for a kc-dev test slot';

/**
 * Pure decision. `me` = { id, stepStartedAt, queuedAt? }; `jobs` = other in-progress jobs, each
 * { id, status, queuedAt?, steps: [{ name, status, started_at }] }. A waiter's place in the queue is
 * its `queuedAt` (inherited from the cancelled runs it replaces, see inheritedStart) when known, else
 * its slot step's start. Returns { go, holders, ahead }.
 */
export function decide(me, jobs, slots) {
  const mine = Date.parse(me.queuedAt ?? me.stepStartedAt);
  let holders = 0;
  let ahead = 0;
  for (const job of jobs) {
    if (job.id === me.id || job.status !== 'in_progress') continue;
    const step = (job.steps ?? []).find((s) => s.name === SLOT_STEP);
    if (!step) continue;
    if (step.status === 'completed') holders += 1;
    else if (step.status === 'in_progress' && step.started_at) {
      const a = Date.parse(job.queuedAt ?? step.started_at);
      if (a < mine || (a === mine && job.id < me.id)) ahead += 1;
    }
  }
  return { go: holders + ahead < slots, holders, ahead };
}

/** A failed GitHub API call; `retryAfterMs` comes from Retry-After or X-RateLimit-Reset when sent. */
export class ApiError extends Error {
  constructor(status, path, retryAfterMs) {
    super(`${status} ${path}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** How long a failed call asks us to wait (ms), from its headers; null when it does not say. */
export function retryAfterMs(headers, nowMs = Date.now()) {
  const after = Number.parseInt(headers.get('retry-after') ?? '', 10);
  if (Number.isFinite(after) && after >= 0) return after * 1000;
  if (headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number.parseInt(headers.get('x-ratelimit-reset') ?? '', 10);
    if (Number.isFinite(reset)) return Math.max(0, reset * 1000 - nowMs);
  }
  return null;
}

/** Wait before asking again after an API error: what the API asked for, else the poll interval; at most `capMs`. */
export function backoffMs(err, pollMs, capMs) {
  const asked = err instanceof ApiError && err.retryAfterMs != null ? err.retryAfterMs + 1000 : pollMs;
  return Math.min(Math.max(asked, pollMs), capMs);
}

export const INHERIT_LOOKBACK_MS = 3 * 60 * 60_000;
export const INHERIT_MAX_LINKS = 4;

/**
 * Pure. The queue place a waiting job inherits from the runs it replaces, or null.
 * `createdAt` = its run's creation; `predecessors` = newest first: the earlier attempts of its run,
 * then the earlier runs of the same workflow, branch and event, each { conclusion, step } where
 * `conclusion` is the same-named job's (or the run's) and `step` its SLOT_STEP ({ conclusion,
 * started_at }) or null. Walks back while they were cancelled: a cancelled one that was waiting
 * passes on its start; one cancelled before it queued (no step, or a skipped one) is passed over. Stops at one that finished any
 * other way, or that got a slot (it had its turn), after INHERIT_MAX_LINKS, or older than the
 * lookback — so a place cannot be kept for ever.
 */
export function inheritedStart(createdAt, predecessors, { lookbackMs = INHERIT_LOOKBACK_MS, maxLinks = INHERIT_MAX_LINKS } = {}) {
  const floor = Date.parse(createdAt) - lookbackMs;
  let best = null;
  for (const p of predecessors.slice(0, maxLinks)) {
    if (p.conclusion !== 'cancelled') break;
    const step = p.step;
    if (step?.conclusion === 'success') break;
    // Only a step cancelled while it waited held a place; a skipped one never queued.
    if (step?.conclusion !== 'cancelled' || !step.started_at) continue;
    const t = Date.parse(step.started_at);
    if (!(t >= floor)) break;
    if (best === null || t < Date.parse(best)) best = step.started_at;
  }
  return best;
}

async function gh(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new ApiError(res.status, path, retryAfterMs(res.headers));
  return res.json();
}

/**
 * Workflow files (`.github/workflows/<file>`) whose runs can hold a slot: those that run this script
 * and, transitively, those that call them (`uses: ./.github/workflows/<file>`). `files` maps a file
 * name to its text. An empty result means "unknown": the caller then reads every run.
 */
export function slotWorkflows(files) {
  const holders = new Set(Object.keys(files).filter((f) => files[f].includes('scripts/kc-dev-slot.mjs')));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [f, text] of Object.entries(files)) {
      if (holders.has(f)) continue;
      const called = [...text.matchAll(/uses:\s*\.\/\.github\/workflows\/([\w.-]+\.ya?ml)/g)].map((m) => m[1]);
      if (called.some((c) => holders.has(c))) {
        holders.add(f);
        grew = true;
      }
    }
  }
  return new Set([...holders].map((f) => `.github/workflows/${f}`));
}

function readSlotWorkflows(dir = '.github/workflows') {
  try {
    const files = {};
    for (const f of readdirSync(dir)) if (/\.ya?ml$/.test(f)) files[f] = readFileSync(join(dir, f), 'utf8');
    return slotWorkflows(files);
  } catch {
    return new Set();
  }
}

async function inProgressJobs(repo, token, workflows) {
  const runs = await gh(`/repos/${repo}/actions/runs?status=in_progress&per_page=100`, token);
  const jobs = [];
  for (const run of runs.workflow_runs ?? []) {
    if (workflows.size > 0 && !workflows.has(run.path)) continue;
    const page = await gh(`/repos/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, token);
    for (const j of page.jobs ?? []) jobs.push({ ...j, run });
  }
  return jobs;
}

const slotStepOf = (job) => (job?.steps ?? []).find((s) => s.name === SLOT_STEP) ?? null;

/** Predecessors of `run`'s job `jobName`, newest first, as inheritedStart wants them (reads the API). */
async function predecessors(repo, token, run, jobName) {
  const out = [];
  const floor = Date.parse(run.created_at) - INHERIT_LOOKBACK_MS;
  for (let a = run.run_attempt - 1; a >= 1 && out.length < INHERIT_MAX_LINKS; a -= 1) {
    const page = await gh(`/repos/${repo}/actions/runs/${run.id}/attempts/${a}/jobs?per_page=100`, token);
    const job = (page.jobs ?? []).find((j) => j.name === jobName);
    out.push({ conclusion: job?.conclusion ?? null, step: slotStepOf(job) });
    if (job?.conclusion !== 'cancelled') return out;
  }
  if (!run.workflow_id || !run.head_branch) return out;
  const q = `branch=${encodeURIComponent(run.head_branch)}&event=${encodeURIComponent(run.event)}&per_page=10`;
  const list = await gh(`/repos/${repo}/actions/workflows/${run.workflow_id}/runs?${q}`, token);
  const earlier = (list.workflow_runs ?? [])
    .filter((r) => r.id !== run.id && Date.parse(r.created_at) < Date.parse(run.created_at) && Date.parse(r.created_at) >= floor)
    .sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at));
  for (const r of earlier) {
    if (out.length >= INHERIT_MAX_LINKS || r.conclusion !== 'cancelled') {
      out.push({ conclusion: r.conclusion, step: null });
      break;
    }
    const page = await gh(`/repos/${repo}/actions/runs/${r.id}/attempts/${r.run_attempt}/jobs?per_page=100`, token);
    const job = (page.jobs ?? []).find((j) => j.name === jobName);
    out.push({ conclusion: job?.conclusion ?? r.conclusion, step: slotStepOf(job) });
    if ((job?.conclusion ?? r.conclusion) !== 'cancelled') break;
  }
  return out;
}

/**
 * Sets `queuedAt` on each waiting job (and returns it for `meJob`): the earlier of its slot step's
 * start and the place inherited from the cancelled runs it replaces. Cached per job: a job's
 * predecessors are finished, so the answer does not change, and each waiter reads them only once.
 */
const inheritCache = new Map();
async function withQueuePlaces(repo, token, jobs) {
  for (const job of jobs) {
    const step = slotStepOf(job);
    if (job.status !== 'in_progress' || step?.status !== 'in_progress' || !step.started_at || !job.run) continue;
    if (!inheritCache.has(job.id)) {
      let inherited = null;
      try {
        inherited = inheritedStart(job.run.created_at, await predecessors(repo, token, job.run, job.name));
      } catch (err) {
        // Not cached: ask again next poll. Until then it queues by its own start (the old behaviour).
        console.log(`::warning::kc-dev slot: could not read the runs job ${job.id} replaces (${err.message})`);
        continue;
      }
      inheritCache.set(job.id, inherited);
      if (inherited) console.log(`kc-dev slot: job ${job.id} (${job.run.head_branch}) keeps its place from ${inherited}`);
    }
    const inherited = inheritCache.get(job.id);
    job.queuedAt = inherited && Date.parse(inherited) < Date.parse(step.started_at) ? inherited : step.started_at;
  }
  return jobs;
}

/** This job in its own run's job list (matched by runner), with its slot step's start if recorded. */
export function findMe(jobs, runnerName) {
  const me = jobs.find((j) => j.status === 'in_progress' && j.runner_name === runnerName);
  if (!me) return null;
  const step = (me.steps ?? []).find((s) => s.name === SLOT_STEP);
  return { id: me.id, name: me.name, stepStartedAt: step?.started_at ?? null };
}

async function main(env = process.env) {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  const slots = Math.max(1, Number.parseInt(env.KC_DEV_TEST_SLOTS || '2', 10) || 2);
  const maxWaitMs = Math.max(0, Number(env.KC_DEV_SLOT_MAX_WAIT_MIN || 120)) * 60_000;
  const pollMs = Number(env.KC_DEV_SLOT_POLL_MS || 60_000);
  const started = Date.now();
  if (!token || !repo) {
    console.log('::warning::kc-dev slot: no token/repository; not waiting');
    return;
  }
  const workflows = readSlotWorkflows();
  if (workflows.size === 0) console.log('::warning::kc-dev slot: could not read .github/workflows; checking every in-progress run');
  let myStartedAt = null;
  let lookups = 0;
  let errors = 0;
  for (;;) {
    let waitMs = pollMs;
    try {
      const mine = await gh(`/repos/${repo}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT || 1}/jobs?per_page=100`, token);
      const me = findMe(mine.jobs ?? [], env.RUNNER_NAME);
      lookups += 1;
      if (!me) {
        // The jobs API lags a few seconds behind the runner; retry before giving up.
        if (lookups < 6) {
          await new Promise((r) => setTimeout(r, Math.min(pollMs, 10_000)));
          continue;
        }
        console.log('::warning::kc-dev slot: could not find this job; not waiting');
        return;
      }
      // Until the API records this step's start, queue as of now (the back of the line).
      myStartedAt = me.stepStartedAt ?? myStartedAt ?? new Date().toISOString();
      const jobs = await withQueuePlaces(repo, token, await inProgressJobs(repo, token, workflows));
      // My own place: what withQueuePlaces worked out for me when my run is in the list, else my start.
      const queuedAt = jobs.find((j) => j.id === me.id)?.queuedAt ?? myStartedAt;
      const { go, holders, ahead } = decide({ id: me.id, stepStartedAt: myStartedAt, queuedAt }, jobs, slots);
      if (go) {
        console.log(`kc-dev slot acquired (${holders} held, ${ahead} ahead, ${slots} slot(s), queued since ${queuedAt}, waited ${Math.round((Date.now() - started) / 1000)}s)`);
        return;
      }
      console.log(`waiting for a kc-dev slot: ${holders} held, ${ahead} ahead, ${slots} slot(s)`);
    } catch (err) {
      // Never a free pass: a rate limit hits every waiter at once, and letting them all through is
      // exactly the stampede this throttle exists to prevent. Wait and ask again.
      errors += 1;
      waitMs = backoffMs(err, pollMs, 10 * 60_000);
      console.log(`::warning::kc-dev slot: GitHub API ${err.message} (error ${errors}); still waiting, next check in ${Math.round(waitMs / 1000)}s`);
    }
    if (Date.now() - started >= maxWaitMs) {
      console.log(`::warning::kc-dev slot: no slot after ${Math.round(maxWaitMs / 60000)} min (${errors} API error(s)); proceeding anyway`);
      return;
    }
    await new Promise((r) => setTimeout(r, Math.min(waitMs, Math.max(1000, maxWaitMs - (Date.now() - started)))));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
