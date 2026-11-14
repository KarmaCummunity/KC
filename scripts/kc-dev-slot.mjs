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
// Best effort: after KC_DEV_SLOT_MAX_WAIT_MIN (default 120) it proceeds with a warning, and an
// API error never fails the job, so a broken throttle cannot block CI.
//
// Needs GITHUB_TOKEN with `actions: read`. Env: GITHUB_REPOSITORY, GITHUB_RUN_ID,
// GITHUB_RUN_ATTEMPT, RUNNER_NAME (set by Actions).
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

async function gh(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

async function inProgressJobs(repo, token) {
  const runs = await gh(`/repos/${repo}/actions/runs?status=in_progress&per_page=100`, token);
  const jobs = [];
  for (const run of runs.workflow_runs ?? []) {
    const page = await gh(`/repos/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, token);
    jobs.push(...(page.jobs ?? []));
  }
  return jobs;
}

async function main(env = process.env) {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  const slots = Math.max(1, Number.parseInt(env.KC_DEV_TEST_SLOTS || '2', 10) || 2);
  const maxWaitMs = Math.max(0, Number(env.KC_DEV_SLOT_MAX_WAIT_MIN || 120)) * 60_000;
  const pollMs = Number(env.KC_DEV_SLOT_POLL_MS || 30_000);
  const started = Date.now();
  if (!token || !repo) {
    console.log('::warning::kc-dev slot: no token/repository; not waiting');
    return;
  }
  for (;;) {
    try {
      const mine = await gh(`/repos/${repo}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT || 1}/jobs?per_page=100`, token);
      const me = (mine.jobs ?? []).find((j) => j.status === 'in_progress' && j.runner_name === env.RUNNER_NAME);
      const myStep = me?.steps?.find((s) => s.name === SLOT_STEP);
      if (!me || !myStep?.started_at) {
        console.log('::warning::kc-dev slot: could not find this job or its slot step; not waiting');
        return;
      }
      const { go, holders, ahead } = decide({ id: me.id, stepStartedAt: myStep.started_at }, await inProgressJobs(repo, token), slots);
      if (go) {
        console.log(`kc-dev slot acquired (${holders} held, ${ahead} ahead, ${slots} slot(s), waited ${Math.round((Date.now() - started) / 1000)}s)`);
        return;
      }
      console.log(`waiting for a kc-dev slot: ${holders} held, ${ahead} ahead, ${slots} slot(s)`);
    } catch (err) {
      console.log(`::warning::kc-dev slot: ${err.message}; not waiting`);
      return;
    }
    if (Date.now() - started >= maxWaitMs) {
      console.log(`::warning::kc-dev slot: still busy after ${Math.round(maxWaitMs / 60000)} min; proceeding anyway`);
      return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
