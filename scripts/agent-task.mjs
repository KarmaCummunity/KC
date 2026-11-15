#!/usr/bin/env node
// Queue and claim steps of the kc-issue-to-merge skill (.claude/skills/kc-issue-to-merge), one
// command each, with compact output so every agent spends few tokens and behaves the same way.
//
//   node scripts/agent-task.mjs next [--limit 5] [--tech-debt]  eligible issues, highest priority first
//   node scripts/agent-task.mjs check <N>                       claim, open PRs and duplicate candidates
//   node scripts/agent-task.mjs claim <N> --agent <you>         claim; prints WON, LOST or SKIP
//   node scripts/agent-task.mjs release <N> --agent <you> [--blocked "<reason>"] [--note <file>] [--force]
//
// Every GitHub call is `gh api` (REST), so it also runs where GraphQL is blocked. All agents post
// as the same GitHub user, so a claim names its agent and a random session id: two sessions of
// the same agent can still tell which one won a race.
//
// Comment protocol (the claim log of an issue):
//   claimed by agent:<a> (session <s>)       a claim
//   withdrawn by agent:<a> (session <s>): …  that session lost a race; its claim no longer counts
//   released by …                            every claim before it no longer counts
// The holder is the earliest claim after the last release whose session has not withdrawn.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO = 'KarmaCummunity/KC';
export const PRIORITIES = ['launch', 'P0', 'P1', 'P2', 'P3'];
export const AGENTS = ['claude', 'cursor', 'codex', 'antigravity', 'kc-bot'];
/** Labels that keep an issue out of the agent queue (owner:* is filtered client-side). */
export const QUEUE_EXCLUDED_LABELS = [
  'in-progress', 'blocked', 'needs-triage', 'ops-alert', 'epic',
  'human', 'maintainer-only', 'possible-duplicate', 'verification',
];
/** A claim with no open PR is stale after this long (docs/agents/ISSUE_CLAIMS.md). */
export const STALE_CLAIM_MS = 6 * 3600_000;
/** A claim this recent may still be adding its labels, so a missing label does not void it. */
export const CLAIM_GRACE_MS = 10 * 60_000;
/** Pause before a claimer re-reads the log, so a racing claim or release posted meanwhile shows. */
export const CLAIM_SETTLE_MS = 5_000;
/** One search page: large enough that rows dropped client-side cannot hide eligible issues. */
const SEARCH_PAGE = 30;
/** Flags that take no value. */
const BOOLEAN_FLAGS = new Set(['tech-debt', 'force']);
const ISSUE = (n) => `repos/${REPO}/issues/${n}`;
const STOP_WORDS = new Set(['with', 'from', 'into', 'that', 'this', 'when', 'have', 'only', 'file', 'should', 'after', 'before', 'urgent']);

/** GitHub search query for open issues with `label` that no agent or person holds. */
function eligibleQuery(label) {
  const excluded = QUEUE_EXCLUDED_LABELS.map((l) => `-label:${l}`).join(' ');
  return `repo:${REPO} is:issue is:open label:${label} ${excluded}`;
}

/** GitHub search query for open, prioritised issues no agent or person holds. */
export function queueQuery(priority) {
  return eligibleQuery(`priority:${priority}`);
}

/** True when only a person can do or verify the issue (search cannot exclude `owner:*`). */
export function isReservedForPerson(labels) {
  return labels.some((l) => l.startsWith('owner:') || ['human', 'maintainer-only', 'verification'].includes(l));
}

/** The claim that holds the issue (see the comment protocol above), or null. */
export function claimWinner(comments) {
  const log = Array.isArray(comments) ? comments : [];
  const live = log.slice(log.findLastIndex((c) => /^released by /.test(c.body)) + 1);
  // Sessions that lost a race; their earlier claims must not hold the issue.
  const withdrawn = new Set(live.map((c) => /^withdrawn by \S+ \(session ([0-9a-z]+)\)/.exec(c.body)?.[1]).filter(Boolean));
  for (const c of live) {
    const m = /^claimed by (?:agent:)?([a-z-]+)(?: \(session ([0-9a-z]+)\))?/.exec(c.body);
    if (m && !(m[2] && withdrawn.has(m[2]))) return { agent: m[1], session: m[2] ?? null, at: c.created_at };
  }
  return null;
}

/** Up to three distinctive words of a title, for a duplicate search. */
export function extractKeywords(title) {
  const words = title.replace(/\[[^\]]*\]/g, ' ').toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return words.filter((w) => w.length >= 4 && !STOP_WORDS.has(w)).slice(0, 3);
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const name = rest[i].startsWith('--') ? rest[i].slice(2) : null;
    if (name === null) positional.push(rest[i]);
    else if (BOOLEAN_FLAGS.has(name)) flags[name] = true;
    // A value flag never swallows the next flag (`--blocked --note f` is a mistake, not a reason).
    else if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) throw new Error(`--${name} needs a value`);
    else flags[name] = rest[++i];
  }
  const issue = positional[0] ? Number(positional[0]) : undefined;
  if (['check', 'claim', 'release'].includes(command) && !Number.isInteger(issue)) throw new Error(`${command} needs an issue number`);
  if (['claim', 'release'].includes(command) && !AGENTS.includes(flags.agent)) {
    throw new Error(`unknown agent "${flags.agent}"; use one of ${AGENTS.join(', ')}`);
  }
  return issue === undefined ? { command, flags } : { command, issue, flags };
}

/** Runs `gh api` with REST arguments and parses its JSON output ({} when empty). */
function ghApi(args) {
  const out = execFileSync('gh', ['api', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.trim() ? JSON.parse(out) : {};
}

/** Blocks the (synchronous) CLI for `ms` milliseconds. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The commands, over an injectable `gh`, clock and sleep so tests run without the network. */
export function makeCommands({
  gh = ghApi,
  now = Date.now,
  nonce = () => randomBytes(3).toString('hex'),
  sleep = sleepSync,
} = {}) {
  const labelsOf = (issue) => (issue.labels ?? []).map((l) => l.name);
  /** The queue reads oldest first; duplicate lookups keep GitHub's best-match order. */
  const search = (q, perPage, { oldestFirst = false } = {}) => {
    const order = oldestFirst ? ['-f', 'sort=created', '-f', 'order=asc'] : [];
    return gh(['-X', 'GET', 'search/issues', '-f', `q=${q}`, ...order, '-f', `per_page=${perPage}`]).items ?? [];
  };
  const comments = (n) => gh([`${ISSUE(n)}/comments?per_page=100`]);
  const comment = (n, body) => gh(['-X', 'POST', `${ISSUE(n)}/comments`, '-f', `body=${body}`]);
  const unlabel = (n, label) => {
    try { gh(['-X', 'DELETE', `${ISSUE(n)}/labels/${label}`]); } catch { /* label already gone */ }
  };
  // Full-text search matches a bare number anywhere, so keep only PRs whose body cites `#N`.
  const openPrs = (n) => search(`repo:${REPO} is:pr is:open ${n} in:body`, 10)
    .filter((pr) => new RegExp(`#${n}\\b`).test(pr.body ?? ''))
    .map((pr) => `#${pr.number} ${pr.title}`);
  const ageOf = (claim) => now() - Date.parse(claim.at);

  /** Why the issue cannot be claimed now, or null when it can. */
  function blocker(n, issue) {
    const labels = labelsOf(issue);
    if (issue.state !== 'open') return 'closed';
    if (isReservedForPerson(labels)) return 'reserved for a person';
    const prs = openPrs(n);
    if (prs.length > 0) return `open PR ${prs[0]}`;
    if (!labels.includes('in-progress')) return null;
    const holder = claimWinner(comments(n));
    if (holder && ageOf(holder) < STALE_CLAIM_MS) return `claimed by agent:${holder.agent}`;
    return null;
  }

  /**
   * Voids an old claim that no longer holds the issue, so it cannot win against the new one: a
   * stale claim, or one whose labels a sweep or merge removed without a release comment. A claim
   * inside its grace period is left alone; it may be a racing claimer still adding its labels.
   */
  function voidDeadClaim(n, issue) {
    const prior = claimWinner(comments(n));
    if (!prior) return;
    if (labelsOf(issue).includes('in-progress')) comment(n, 'released by agent-task: stale claim (over 6h, no open PR)');
    else if (ageOf(prior) >= CLAIM_GRACE_MS) comment(n, 'released by agent-task: no live claim (claim labels were removed)');
  }

  return {
    next({ limit = 5, 'tech-debt': techDebt = false } = {}) {
      // Filter a full page first, then cut to `limit`: owner-reserved rows must not eat the slots.
      const eligible = (query) => search(query, SEARCH_PAGE, { oldestFirst: true })
        .filter((i) => !isReservedForPerson(labelsOf(i)))
        .slice(0, Number(limit))
        .map((i) => `#${i.number} ${i.title} [${labelsOf(i).join(',')}]`);
      // The loop's fallback once the prioritised queue is empty (AGENTS.md §13).
      if (techDebt) {
        const rows = eligible(eligibleQuery('tech-debt'));
        return rows.length > 0 ? ['tech-debt', ...rows] : ['queue empty'];
      }
      for (const priority of PRIORITIES) {
        const rows = eligible(queueQuery(priority));
        if (rows.length > 0) return [`priority:${priority}`, ...rows];
      }
      return ['queue empty'];
    },

    check(n) {
      const issue = gh([ISSUE(n)]);
      const words = extractKeywords(issue.title ?? '').join(' ');
      const similar = words ? search(`repo:${REPO} is:issue ${words} in:title,body`, 6).filter((i) => i.number !== n) : [];
      const merged = words ? search(`repo:${REPO} is:pr is:merged ${words}`, 3) : [];
      return [
        `#${n} [${issue.state}] ${issue.title} [${labelsOf(issue).join(',')}]`,
        `claimable: ${blocker(n, issue) ?? 'yes'}`,
        ...similar.map((i) => `similar issue #${i.number} [${i.state}] ${i.title}`),
        ...merged.map((pr) => `merged PR #${pr.number} ${pr.title}`),
      ];
    },

    claim(n, { agent }) {
      const issue = gh([ISSUE(n)]);
      const why = blocker(n, issue);
      if (why) return [`SKIP #${n}: ${why}`];
      voidDeadClaim(n, issue);
      const session = nonce();
      // Labels before the comment: a racing claimer that sees the comment also sees the labels.
      gh(['-X', 'POST', `${ISSUE(n)}/labels`, '-f', 'labels[]=in-progress', '-f', `labels[]=agent:${agent}`]);
      comment(n, `claimed by agent:${agent} (session ${session})`);
      let winner = claimWinner(comments(n));
      if (winner?.session === session) {
        // Read again after a pause: a racing release or claim posted meanwhile can still win.
        sleep(CLAIM_SETTLE_MS);
        winner = claimWinner(comments(n));
        if (winner?.session === session) return [`WON #${n} as agent:${agent} (session ${session})`];
      }
      // Same agent: the winner needs the shared agent label too, so only a different agent drops it.
      if (winner?.agent !== agent) unlabel(n, `agent:${agent}`);
      comment(n, `withdrawn by agent:${agent} (session ${session}): lost the claim race`);
      return [`LOST #${n} to agent:${winner?.agent} (session ${winner?.session})`];
    },

    release(n, { agent, blocked, note, force = false }) {
      // Check everything before the first write, so a bad call changes nothing.
      if (note && !existsSync(note)) throw new Error(`note file not found: ${note}`);
      const holder = claimWinner(comments(n));
      if (holder && holder.agent !== agent && !force) {
        return [`REFUSED #${n}: held by agent:${holder.agent} (session ${holder.session}); pass --force to release it anyway`];
      }
      unlabel(n, 'in-progress');
      unlabel(n, `agent:${agent}`);
      if (blocked) gh(['-X', 'POST', `${ISSUE(n)}/labels`, '-f', 'labels[]=blocked']);
      const reason = blocked ? `: blocked on: ${blocked}` : '';
      const body = note ? `\n\n${readFileSync(note, 'utf8')}` : '';
      comment(n, `released by agent:${agent}${reason}${body}`);
      return [`RELEASED #${n}${blocked ? ' (blocked)' : ''}`];
    },
  };
}

function main() {
  const { command, issue, flags } = parseArgs(process.argv.slice(2));
  const commands = makeCommands();
  if (!(command in commands)) {
    throw new Error('usage: agent-task.mjs next [--tech-debt] | check <N> | claim <N> --agent <you> | release <N> --agent <you>');
  }
  const out = command === 'next' ? commands.next(flags) : commands[command](issue, flags);
  console.log(out.join('\n'));
  if (/^(LOST|SKIP|REFUSED)/.test(out.at(-1))) process.exitCode = 3;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (err) { console.error(`agent-task: ${err.message}`); process.exitCode = 2; }
}
