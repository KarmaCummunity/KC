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
 * Pure decision. `me` = { id, stepStartedAt }; `jobs` = other in-progress jobs, each
 * { id, status, steps: [{ name, status, started_at }] }. Returns { go, holders, ahead }.
 */
export function decide(me, jobs, slots) {
  let holders = 0;
  let ahead = 0;
  for (const job of jobs) {
    if (job.id === me.id || job.status !== 'in_progress') continue;
    const step = (job.steps ?? []).find((s) => s.name === SLOT_STEP);
    if (!step) continue;
    if (step.status === 'completed') holders += 1;
    else if (step.status === 'in_progress' && step.started_at) {
      const a = Date.parse(step.started_at);
      const b = Date.parse(me.stepStartedAt);
      if (a < b || (a === b && job.id < me.id)) ahead += 1;
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
    jobs.push(...(page.jobs ?? []));
  }
  return jobs;
}

/** This job in its own run's job list (matched by runner), with its slot step's start if recorded. */
export function findMe(jobs, runnerName) {
  const me = jobs.find((j) => j.status === 'in_progress' && j.runner_name === runnerName);
  if (!me) return null;
  const step = (me.steps ?? []).find((s) => s.name === SLOT_STEP);
  return { id: me.id, stepStartedAt: step?.started_at ?? null };
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
      const { go, holders, ahead } = decide({ id: me.id, stepStartedAt: myStartedAt }, await inProgressJobs(repo, token, workflows), slots);
      if (go) {
        console.log(`kc-dev slot acquired (${holders} held, ${ahead} ahead, ${slots} slot(s), waited ${Math.round((Date.now() - started) / 1000)}s)`);
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
