// Pure helpers of the weekly release train (scripts/release-train.mjs,
// .github/workflows/release-train.yml). No I/O here, so every rule that can
// stop a release is unit-tested (scripts/release-train.test.mjs).
import { skipTokensIn } from './release-merge.mjs';

/** Labels and names shared with the workflow and the docs. */
export const FREEZE_LABEL = 'no-auto-merge';
export const TRAIN_LABELS = ['area:ci', 'agent:kc-bot'];
export const RELEASE_E2E_CHECK = 'release / dev E2E on the release head';
export const REQUIRED_CHECKS = ['CI gate', 'CI verdict'];
/** Check runs that are never the train's business (deploy jobs on the same SHA, skipped callers). */
export const IGNORED_CHECKS = new Set(['approve release', 'tag release']);
const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required', 'stale']);

/** `1.9.143` → `1.9.144`. Throws on anything but MAJOR.MINOR.PATCH. */
export function nextPatch(version) {
  const m = String(version ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`app/VERSION is not MAJOR.MINOR.PATCH: "${version}"`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** True when GitHub starts no workflow for a commit with this message. */
export function isCiSkipped(message) {
  return skipTokensIn(message).length > 0;
}

/**
 * Should this week's train run at all? `compare` is GitHub's
 * compare main...dev (ahead_by, files). dev with nothing new → skip.
 */
export function skipDecision(compare) {
  const ahead = Number(compare?.ahead_by ?? 0);
  if (ahead === 0) return { skip: true, reason: 'dev has no commits that main lacks' };
  const files = (compare.files ?? []).filter((f) => f.filename !== 'app/VERSION');
  if (Array.isArray(compare.files) && compare.files.length > 0 && files.length === 0) {
    return { skip: true, reason: 'dev differs from main only in app/VERSION' };
  }
  if (Array.isArray(compare.files) && compare.files.length === 0) {
    return { skip: true, reason: 'dev and main have the same tree (only sync/bump commits)' };
  }
  return { skip: false, reason: `dev is ${ahead} commit(s) ahead of main` };
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

/**
 * Statement rules that stop the train. Stricter than the CI release scan
 * (scripts/check-migration-safety.mjs): the train ignores `migration-safety:
 * allow` markers, because an allowed destructive change still needs a human
 * to choose the release moment. Such a release goes out by hand.
 */
export const TRAIN_RULES = [
  { id: 'drop-table', re: /^DROP\s+TABLE\b/i, what: 'DROP TABLE' },
  { id: 'drop-schema', re: /^DROP\s+SCHEMA\b/i, what: 'DROP SCHEMA' },
  { id: 'drop-type', re: /^DROP\s+TYPE\b/i, what: 'DROP TYPE' },
  { id: 'drop-database', re: /^DROP\s+DATABASE\b/i, what: 'DROP DATABASE' },
  // `ALTER TABLE t DROP [COLUMN] c` (COLUMN is optional in Postgres); not DROP CONSTRAINT/DEFAULT/NOT NULL/….
  { id: 'drop-column', re: /\bDROP\s+(?:COLUMN\b|(?!CONSTRAINT\b|DEFAULT\b|NOT\b|IDENTITY\b|EXPRESSION\b)"?[a-z_])/i, what: 'ALTER TABLE … DROP COLUMN', only: /^ALTER\s+TABLE\b/i },
  { id: 'alter-column-type', re: /\bALTER\s+(COLUMN\s+)?"?[a-z_][a-z0-9_]*"?\s+(SET\s+DATA\s+)?TYPE\b/i, what: 'ALTER COLUMN … TYPE (may lose data)', only: /^ALTER\s+TABLE\b/i },
  { id: 'rename', re: /\bRENAME\b/i, what: 'RENAME (the previous release cannot run against it)', only: /^ALTER\s+(TABLE|SCHEMA|TYPE)\b/i },
  { id: 'truncate', re: /^TRUNCATE\b/i, what: 'TRUNCATE' },
  { id: 'delete-without-where', re: /^DELETE\s+FROM\b(?![\s\S]*\bWHERE\b)/i, what: 'DELETE without WHERE' },
  { id: 'update-without-where', re: /^UPDATE\s+[a-z0-9_."]+\s+SET\b(?![\s\S]*\bWHERE\b)/i, what: 'UPDATE without WHERE' },
];

/** Strip comments, dollar-quoted bodies and string literals so rules see only statements. */
export function sqlStatements(sql) {
  let text = String(sql ?? '');
  text = text.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, "''"); // function bodies, DO blocks
  text = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  text = text.replace(/--[^\n]*/g, ' ');
  text = text.replace(/'(?:[^']|'')*'/g, "''");
  return text
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Destructive statements in one migration file. */
export function scanMigrationSql(name, sql) {
  const findings = [];
  for (const stmt of sqlStatements(sql)) {
    for (const rule of TRAIN_RULES) {
      if (rule.only && !rule.only.test(stmt)) continue;
      if (rule.re.test(stmt)) findings.push({ file: name, rule: rule.id, what: rule.what, statement: stmt.slice(0, 160) });
    }
  }
  return findings;
}

/**
 * `git diff --name-status main...dev -- supabase/migrations` lines. New files
 * are scanned; an edited, deleted or renamed migration is itself a stop
 * (prod already applied the old text).
 */
export function migrationChanges(nameStatus) {
  const added = [];
  const problems = [];
  for (const line of String(nameStatus ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const [status, ...paths] = line.split(/\t+/);
    const file = paths[paths.length - 1];
    if (!file || !file.endsWith('.sql')) continue;
    if (status === 'A') added.push(file);
    else problems.push({ file, rule: 'edited-migration', what: `existing migration ${status === 'D' ? 'deleted' : status.startsWith('R') ? 'renamed' : 'edited'} (${status})` });
  }
  return { added, problems };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Newest check run per name (GitHub keeps every rerun and event). */
export function latestByName(checkRuns) {
  const latest = new Map();
  for (const run of checkRuns ?? []) {
    const prev = latest.get(run.name);
    if (!prev || Number(run.id) > Number(prev.id)) latest.set(run.name, run);
  }
  return latest;
}

/**
 * Verdict on the release PR head: `success` once every required check and the
 * release E2E passed and nothing is still running; `failure` as soon as any
 * newest check run or commit status failed; `pending` otherwise.
 */
export function judgeChecks({ checkRuns, statuses, required = [...REQUIRED_CHECKS, RELEASE_E2E_CHECK] }) {
  const latest = latestByName(checkRuns);
  const failing = [];
  const running = [];
  for (const [name, run] of latest) {
    if (IGNORED_CHECKS.has(name)) continue;
    if (run.status !== 'completed') running.push(name);
    else if (FAILED.has(run.conclusion)) failing.push(`${name}: ${run.conclusion}`);
  }
  const latestStatus = new Map();
  for (const s of statuses ?? []) {
    const prev = latestStatus.get(s.context);
    if (!prev || String(s.updated_at) > String(prev.updated_at)) latestStatus.set(s.context, s);
  }
  for (const [context, s] of latestStatus) {
    if (s.state === 'failure' || s.state === 'error') failing.push(`${context}: ${s.state}`);
    else if (s.state === 'pending') running.push(context);
  }
  const missing = required.filter((name) => {
    const run = latest.get(name);
    return !run || run.status !== 'completed' || run.conclusion !== 'success';
  });
  if (failing.length) return { state: 'failure', failing, running, missing };
  if (missing.length || running.length) return { state: 'pending', failing, running, missing };
  return { state: 'success', failing, running, missing };
}

// ---------------------------------------------------------------------------
// Freeze
// ---------------------------------------------------------------------------

/**
 * Which open PRs into dev the freeze touches (auto-merge armed or queued). `prs` come from GraphQL:
 * { number, isDraft, autoMergeRequest, isInMergeQueue, labels: [names] }.
 * Our own PRs (`exclude`) are left alone.
 */
export function freezePlan(prs, exclude = []) {
  const skip = new Set(exclude.map(Number));
  const plan = [];
  for (const pr of prs ?? []) {
    if (skip.has(Number(pr.number))) continue;
    const armed = Boolean(pr.autoMergeRequest);
    const queued = Boolean(pr.isInMergeQueue);
    const labelled = (pr.labels ?? []).includes(FREEZE_LABEL);
    // Only PRs that could land on their own: armed auto-merge or a queue slot.
    // A PR without either merges only by hand, which the freeze cannot stop.
    if (!armed && !queued) continue;
    plan.push({ number: pr.number, armed, queued, addLabel: !labelled });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------

/** Find the job of a Deploy run by its (possibly nested) name. */
function job(jobs, re) {
  return (jobs ?? []).find((j) => re.test(j.name));
}

/**
 * Verdict on a finished Deploy (main) run: every prod stage green, the backup
 * job green, the tag job green; the rollback jobs say what happened if not.
 */
export function deployVerdict(jobs) {
  const pick = (re) => job(jobs, re)?.conclusion ?? 'missing';
  const stages = {
    backup: pick(/backup \(prod\)/),
    migrations: pick(/migrations · prod/),
    functions: pick(/^edge functions\b.*prod|functions · prod/),
    web: pick(/^web \/ .*prod|web · prod/),
    smoke: pick(/^smoke \/ smoke · prod$/),
    tag: pick(/^tag release/),
  };
  const rollbackJobs = (jobs ?? []).filter((j) => /^rollback \(prod\)/.test(j.name));
  const rollback = rollbackJobs.length === 0
    ? 'not run'
    : rollbackJobs.map((j) => `${j.name.replace(/^rollback \(prod\) \/ /, '')}: ${j.conclusion}`).join(', ');
  const problems = Object.entries(stages).filter(([, c]) => c !== 'success').map(([k, c]) => `${k}: ${c}`);
  return { ok: problems.length === 0, stages, rollback, problems };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const ICON = { success: '✅', skipped: '⏭️', failure: '❌', aborted: '🛑', dry_run: '🧪', running: '⏳' };

/** Markdown for the job summary (and the optional issue comment). */
export function renderSummary(status) {
  const lines = [];
  lines.push(`## Weekly release train — ${ICON[status.outcome] ?? ''} ${status.outcome}${status.dry_run ? ' (dry run)' : ''}`);
  if (status.reason) lines.push('', status.reason);
  lines.push('', '| Step | Result |', '|---|---|');
  for (const step of status.steps ?? []) {
    lines.push(`| ${step.name} | ${ICON[step.result] ?? ''} ${step.result}${step.detail ? ` — ${String(step.detail).replace(/\|/g, '\\|').replace(/\n/g, ' ')}` : ''} |`);
  }
  const facts = [
    ['Version', status.version],
    ['Release PR', status.release_pr && `#${status.release_pr}`],
    ['Release head (dev)', status.head_sha],
    ['main merge commit', status.merge_sha],
    ['Deploy run', status.deploy_run_url],
    ['Store build run', status.store_run_url],
    ['Sync PR', status.sync_pr && `#${status.sync_pr}`],
  ].filter(([, v]) => v);
  if (facts.length) {
    lines.push('', '| | |', '|---|---|');
    for (const [k, v] of facts) lines.push(`| ${k} | ${v} |`);
  }
  if (status.findings?.length) {
    lines.push('', '### Findings');
    for (const f of status.findings) lines.push(`- \`${f.file}\` ${f.what}${f.statement ? `: \`${f.statement}\`` : ''}`);
  }
  if (status.frozen?.length) lines.push('', `Frozen during the train: ${status.frozen.map((n) => `#${n}`).join(' ')}`);
  return lines.join('\n') + '\n';
}
