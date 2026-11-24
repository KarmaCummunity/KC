// GitHub API helpers shared by the CI judge scripts (scripts/ci-gate.mjs and
// scripts/check-test-integrity.mjs). Like the judges, ci.yml runs this file
// from the BASE commit's copy, so a PR cannot change how owner approvals or
// earlier CI runs are read (D-195, INFRA-CI-2).
//
// Owner override rule: a judge that finds a gate-weakening change passes only
// when an owner listed in the base commit's .github/owners.json approved the
// PR's current head SHA, and that owner is not the PR author.
//
// Every API failure throws; callers turn that into a red gate (fail closed). A
// rate limit is waited out first, within CI_GITHUB_RATE_LIMIT_MAX_WAIT_MIN.

import { execFileSync } from 'node:child_process';

export const OWNERS_FILE = '.github/owners.json';

/** Events whose run belongs to one PR, so its reviews can carry an override. */
export const PR_EVENTS = new Set(['pull_request', 'pull_request_review']);

/** Review states that set a reviewer's verdict; COMMENTED and PENDING never do. */
const VERDICT_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

/** Parse the owners allowlist into lower-cased logins. Throws when malformed. */
export function parseOwners(raw) {
  const owners = JSON.parse(raw).owners;
  if (!Array.isArray(owners) || owners.some((o) => typeof o !== 'string' || o.trim() === '')) {
    throw new Error(`${OWNERS_FILE}: "owners" must be an array of GitHub logins`);
  }
  return owners.map((o) => o.trim().toLowerCase());
}

/**
 * Owners allowlist as committed at `ref` (the base commit). A base without the
 * file yields no owners, so no override is possible: the PR's own copy is
 * never trusted, or a PR could list its author as an owner.
 */
export function ownersAt(ref, cwd = process.cwd()) {
  let raw;
  try {
    raw = execFileSync('git', ['show', `${ref}:${OWNERS_FILE}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return [];
  }
  return parseOwners(raw);
}

/**
 * The owner login whose approval covers `headSha`, or null. `reviews` is the
 * chronological list from the reviews API. Only each reviewer's latest verdict
 * counts, so an owner who later requests changes (or whose approval was
 * dismissed) withdraws the override. The approval must be on the exact head
 * commit, by an allowlisted owner, and not by the PR author.
 */
export function ownerApproval({ reviews, owners, headSha, author }) {
  const allow = new Set(owners);
  const latest = new Map();
  for (const review of reviews) {
    const login = review.user?.login?.toLowerCase();
    if (login && VERDICT_STATES.has(review.state)) latest.set(login, review);
  }
  const authorLogin = author?.toLowerCase();
  for (const [login, review] of latest) {
    const approves = review.state === 'APPROVED' && review.commit_id === headSha;
    if (approves && allow.has(login) && login !== authorLogin) return login;
  }
  return null;
}

/**
 * A rate-limited answer: 429, or 403 carrying GitHub's rate-limit signals
 * (Retry-After, X-RateLimit-Remaining: 0, or a "rate limit" message). The
 * GITHUB_TOKEN budget (1,000 requests per hour per repository) is shared by
 * every job, including every kc-dev slot waiter polling once a minute, so a
 * busy queue can exhaust it and a judge then read 403 (PR #2647, 23 Nov 2026).
 * Returns { waitMs, why } or null. Pure apart from reading the answer.
 */
export async function rateLimitOf(res, nowMs = Date.now()) {
  if (res.status !== 403 && res.status !== 429) return null;
  const header = (name) => res.headers?.get?.(name) ?? null;
  let message = '';
  try {
    message = String((await res.clone().json())?.message ?? '');
  } catch {
    message = '';
  }
  const remaining = header('x-ratelimit-remaining');
  const after = Number.parseInt(header('retry-after') ?? '', 10);
  const reset = Number.parseInt(header('x-ratelimit-reset') ?? '', 10);
  const limited = res.status === 429 || Number.isFinite(after) || remaining === '0' || /rate limit/i.test(message);
  if (!limited) return null;
  let waitMs = 60_000; // GitHub's advice for a secondary limit without Retry-After
  if (Number.isFinite(after) && after >= 0) waitMs = after * 1000;
  else if (remaining === '0' && Number.isFinite(reset)) waitMs = Math.max(0, reset * 1000 - nowMs);
  const why = [`remaining=${remaining ?? '?'}`, Number.isFinite(reset) ? `reset=${new Date(reset * 1000).toISOString()}` : null, message ? `"${message.slice(0, 120)}"` : null]
    .filter(Boolean)
    .join(' ');
  return { waitMs, why };
}

/** Longest total wait for rate limits in one call (default 10 min; the gate job allows 25). */
function maxRateWaitMs(env) {
  const min = Number(env.CI_GITHUB_RATE_LIMIT_MAX_WAIT_MIN ?? 10);
  return Number.isFinite(min) && min >= 0 ? min * 60_000 : 600_000;
}

/**
 * fetch with a bounded wait on rate limits. Every other non-2xx answer, and a
 * rate limit that outlasts the budget, still throws (the judges fail closed);
 * the error names the status and, for a rate limit, its headers.
 */
export async function githubFetch(method, path, init, env = process.env, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  const budget = maxRateWaitMs(env);
  let waited = 0;
  for (;;) {
    const res = await fetch(`${api}${path}`, { ...init, method });
    if (res.ok) return res.json();
    const limit = await rateLimitOf(res);
    if (limit && waited + limit.waitMs + 1000 <= budget) {
      const ms = limit.waitMs + 1000;
      console.log(`::warning::GitHub API ${method} ${path} rate-limited (HTTP ${res.status}, ${limit.why}); retrying in ${Math.ceil(ms / 1000)} s`);
      waited += ms;
      await sleep(ms);
      continue;
    }
    const detail = limit ? ` (rate limit: ${limit.why}; waited ${Math.round(waited / 1000)} s of ${Math.round(budget / 1000)} s)` : '';
    throw new Error(`GitHub API ${method} ${path} answered HTTP ${res.status}${detail}`);
  }
}

/** GET one REST resource; throws on any non-2xx answer except a rate limit it can wait out. */
export async function githubGet(path, env = process.env) {
  return githubFetch('GET', path, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  }, env);
}

/** POST a JSON body; throws on any non-2xx answer except a rate limit it can wait out. */
export async function githubPost(path, body, env = process.env) {
  return githubFetch('POST', path, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  }, env);
}

/** Most pages githubList reads before giving up (1,000 items). */
export const MAX_PAGES = 10;

/**
 * GET every page (100 per page) of a list endpoint. Throws instead of
 * returning a truncated list when more than MAX_PAGES pages exist: a missing
 * later review could be the change request that withdraws an approval.
 */
export async function githubList(path, key, env = process.env) {
  const items = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await githubGet(`${path}${sep}per_page=100&page=${page}`, env);
    const batch = key ? body[key] : body;
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error(`GitHub API GET ${path} has more than ${MAX_PAGES * 100} items; refusing to judge a truncated list`);
}

/**
 * Look for an owner approval that overrides a gate-weakening change.
 * Returns { login } on success, or { login: null, why } explaining what is
 * missing. Inputs (env): EVENT_NAME, PR_NUMBER, PR_AUTHOR, HEAD_SHA,
 * GITHUB_REPOSITORY, GITHUB_TOKEN; `judgeRef` is the base commit.
 */
export async function findOwnerOverride(env, judgeRef, cwd = process.cwd()) {
  // Merge groups (and pushes) have no single PR whose reviews could carry an
  // override, so an owner override is unsupported there: such a change must
  // merge through a normal PR, not the merge queue.
  if (!PR_EVENTS.has(env.EVENT_NAME) || !env.PR_NUMBER) {
    return { login: null, why: `a ${env.EVENT_NAME} run has no PR review to carry an owner approval (overrides need a normal PR merge)` };
  }
  const owners = ownersAt(judgeRef, cwd);
  if (owners.length === 0) return { login: null, why: `the base commit has no ${OWNERS_FILE}` };
  const reviews = await githubList(`/repos/${env.GITHUB_REPOSITORY}/pulls/${env.PR_NUMBER}/reviews`, null, env);
  const login = ownerApproval({ reviews, owners, headSha: env.HEAD_SHA, author: env.PR_AUTHOR });
  if (login) return { login };
  const list = owners.map((o) => `@${o}`).join(', ');
  return { login: null, why: `no approving review by ${list} on head ${env.HEAD_SHA} (the PR author cannot approve)` };
}

/** Conclusions that mean a lane did not pass, besides `cancelled`. */
const FAILED = new Set(['failure', 'timed_out', 'startup_failure', 'action_required', 'stale']);

/**
 * Fold the jobs of an earlier CI run into one result per lane, mirroring the
 * `needs.<lane>.result` values the gate judges. A lane's jobs are the caller
 * job itself (listed alone when it skipped) or `<lane> / <inner job>`. A job
 * that never completed counts as a failure; a lane with no job is `missing`.
 */
export function laneResults(jobs, lanes) {
  const results = {};
  for (const lane of lanes) {
    const own = jobs.filter((j) => j.name === lane || j.name.startsWith(`${lane} / `));
    const conclusions = own.map((j) => (j.status === 'completed' ? j.conclusion : 'incomplete'));
    if (own.length === 0) results[lane] = 'missing';
    else if (conclusions.some((c) => FAILED.has(c) || c === 'incomplete')) results[lane] = 'failure';
    else if (conclusions.includes('cancelled')) results[lane] = 'cancelled';
    else if (conclusions.every((c) => c === 'skipped')) results[lane] = 'skipped';
    else if (conclusions.every((c) => c === 'success' || c === 'skipped')) results[lane] = 'success';
    else results[lane] = 'failure';
  }
  return results;
}
