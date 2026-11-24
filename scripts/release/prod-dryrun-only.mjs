// Read-only release planning. No arbitrary argv or shell, and no apply entrypoint.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RELEASE_PLAN } from './prod-dryrun-plan.mjs';
export const DRYRUN_ARGS = Object.freeze(['db', 'push', '--dry-run', '--linked', '--yes']);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
function must(ok, label) { if (!ok) throw new Error(label); }
function git(args) {
  const r = spawnSync('git', args, { encoding: null, maxBuffer: 32 * 1024 * 1024 });
  must(r.status === 0, 'source inspection failed');
  return r.stdout;
}
async function apiJson(url, token, query) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000), method: query ? 'POST' : 'GET', headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
  }, ...(query ? { body: JSON.stringify({ query }) } : {}) });
  must(r.ok, 'read-only API inspection failed');
  return r.json();
}
export function verifyLedger(rows, expected) {
  must(Array.isArray(rows), 'unexpected ledger response');
  const actual = rows.map((r) => String(r.version)).sort();
  must(JSON.stringify(actual) === JSON.stringify([...expected].sort()), 'remote ledger changed');
}
// Supabase CLI ≥ 2.99 (Bun wrapper) appends an update notice to stderr after the plan when a newer
// release exists (seen on 22 Nov 2026 with v3.2.0 out). Exactly these two trailing lines are dropped;
// anything else after the pending block still fails closed.
const UPDATE_NOTICE = [
  /^A new version of Supabase CLI is available: v\d+\.\d+\.\d+ \(currently installed v[0-9.]*\)$/,
  /^We recommend updating regularly for new features and bug fixes: https:\/\/supabase\.com\/docs\/guides\/cli\/getting-started#updating-the-supabase-cli$/,
];
function dropUpdateNotice(lines) {
  const n = UPDATE_NOTICE.length;
  if (lines.length < n) return lines;
  const tail = lines.slice(-n);
  return tail.every((l, i) => UPDATE_NOTICE[i].test(l)) ? lines.slice(0, -n) : lines;
}
export function parseDryRunPlan(stdout, stderr) {
  const clean = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
  const out = clean(stdout).trim(); const err = clean(stderr);
  must(out === 'Finished supabase db push.', 'unrecognized dry-run output');
  const lines = dropUpdateNotice(err.split('\n').map((l) => l.trim()).filter(Boolean));
  const banner = 'DRY RUN: migrations will *not* be pushed to the database.';
  must(lines.filter((l) => l === banner).length === 1, 'unrecognized dry-run output');
  const header = lines.indexOf('Would push these migrations:');
  must(header > lines.indexOf(banner), 'unrecognized dry-run output');
  must(lines.filter((l) => l === 'Would push these migrations:').length === 1, 'unrecognized dry-run output');
  // Connection/version notices may precede the pending block. No filenames or other plans there.
  must(lines.slice(0, header).every((l) => l === banner ||
    /^(Connecting to remote database\.\.\.|Initialising login role\.\.\.)$/.test(l)), 'unrecognized dry-run output');
  const pending = lines.slice(header + 1).map((l) => {
    const m = /^• (\d{4}_[a-z0-9_]+\.sql)$/.exec(l);
    must(m, 'unrecognized dry-run output'); return m[1];
  });
  must(pending.length && new Set(pending).size === pending.length, 'unrecognized dry-run output');
  return pending.sort();
}
/**
 * CLI output made safe to print when the plan cannot be read: connection strings, key/token
 * shapes and `password=`-style pairs are replaced, lines are capped. Migration names and CLI
 * messages stay, so a format change can be diagnosed from the job log.
 */
export function sanitizeCliOutput(text, maxLines = 80) {
  const redact = (l) => l
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]*@[^\s'"]*/gi, '<redacted-url>')
    .replace(/\b(password|passwd|pwd|token|secret|apikey|api_key|authorization)\s*[=:]\s*\S+/gi, '$1=<redacted>')
    .replace(/\b(sbp|sb_secret|sb_publishable|sbp_oauth)_[A-Za-z0-9_-]+/g, '<redacted-key>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '<redacted-jwt>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<redacted-ip>')
    .slice(0, 200);
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').map(redact);
  return (lines.length > maxLines ? [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more line(s)`] : lines).join('\n');
}
function withOutput(err, result) {
  err.sanitizedOutput = `--- stdout\n${sanitizeCliOutput(result?.stdout)}\n--- stderr\n${sanitizeCliOutput(result?.stderr)}`;
  return err;
}
export async function run(env = process.env, deps = {}) {
  const argv = deps.argv ?? process.argv.slice(2);
  const inspectGit = deps.git ?? git;
  const json = deps.json ?? apiJson;
  const spawn = deps.spawn ?? spawnSync;
  const candidate = env.QUALIFIED_CANDIDATE;
  must(argv.length === 0, 'arguments forbidden');
  must(/^[a-f0-9]{40}$/.test(candidate ?? ''), 'qualified candidate must be 40 lowercase hex');
  must(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main', 'manual MAIN only');
  must(/^[a-f0-9]{40}$/.test(env.GITHUB_WORKFLOW_SHA ?? ''), 'trusted workflow SHA missing');
  must(inspectGit(['rev-parse', 'HEAD']).toString().trim() === env.GITHUB_WORKFLOW_SHA, 'tooling not workflow SHA');
  must(env.GITHUB_REPOSITORY === 'KarmaCummunity/KC', 'repository mismatch');
  must(env.SUPABASE_PROJECT_REF === RELEASE_PLAN.project, 'project mismatch');
  must(env.KC_PROD_SCHEMA_MODE === 'baseline', 'schema mode mismatch');
  must(env.SUPABASE_ACCESS_TOKEN && env.SUPABASE_DB_PASSWORD, 'required environment credential missing');
  const dev = await json('https://api.github.com/repos/KarmaCummunity/KC/git/ref/heads/dev', env.GITHUB_TOKEN);
  must(dev.object?.sha === candidate, 'DEV moved, requalify candidate');
  const blob = (path) => inspectGit(['show', `${candidate}:${path}`]);
  must(sha256(blob(RELEASE_PLAN.manifestPath)) === RELEASE_PLAN.manifestSha256, 'manifest changed');
  const files = inspectGit(['ls-tree', '--name-only', `${candidate}:supabase/migrations`])
    .toString().split('\n').filter((x) => x.endsWith('.sql')).sort();
  must(JSON.stringify(files) === JSON.stringify(Object.keys(RELEASE_PLAN.files).sort()), 'migration set mismatch');
  const config = blob('supabase/config.toml');
  must(sha256(config) === RELEASE_PLAN.configSha256, 'config changed');
  const contents = new Map();
  for (const [name, digest] of Object.entries(RELEASE_PLAN.files)) {
    const bytes = blob(`supabase/migrations/${name}`);
    must(sha256(bytes) === digest, 'migration bytes changed'); contents.set(name, bytes);
  }
  const rows = await json(`https://api.supabase.com/v1/projects/${RELEASE_PLAN.project}/database/query`,
    env.SUPABASE_ACCESS_TOKEN,
    'begin transaction read only; select version from supabase_migrations.schema_migrations order by version; rollback;');
  verifyLedger(rows, RELEASE_PLAN.ledger);
  const work = mkdtempSync(join(tmpdir(), 'kc-readonly-plan-'));
  try {
    mkdirSync(join(work, 'supabase', 'migrations'), { recursive: true });
    writeFileSync(join(work, 'supabase', 'config.toml'), config, { mode: 0o600 });
    for (const [name, bytes] of contents) writeFileSync(join(work, 'supabase', 'migrations', name), bytes, { mode: 0o600 });
    const cli = (args) => {
      const result = spawn('supabase', args, { cwd: work, env: { PATH: env.PATH, HOME: work, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD: env.SUPABASE_DB_PASSWORD, DO_NOT_TRACK: '1' }, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 180000 });
      if (result.status !== 0 || result.error) throw withOutput(new Error('CLI read-only planning failed; raw output suppressed'), result);
      return result;
    };
    cli(['link', '--project-ref', RELEASE_PLAN.project, '--yes']);
    const plan = cli(DRYRUN_ARGS);
    let found;
    try { found = parseDryRunPlan(plan.stdout, plan.stderr); } catch (e) { throw withOutput(e, plan); }
    must(JSON.stringify(found) === JSON.stringify([...RELEASE_PLAN.pending].sort()), 'CLI plan differs from reviewed forward set');
    const finalDev = await json('https://api.github.com/repos/KarmaCummunity/KC/git/ref/heads/dev', env.GITHUB_TOKEN);
    must(finalDev.object?.sha === candidate, 'DEV moved, requalify candidate');
    verifyLedger(await json(`https://api.supabase.com/v1/projects/${RELEASE_PLAN.project}/database/query`,
      env.SUPABASE_ACCESS_TOKEN,
      'begin transaction read only; select version from supabase_migrations.schema_migrations order by version; rollback;'), RELEASE_PLAN.ledger);
    console.log(`Read-only plan passed: candidate ${candidate}, ${found.length} pending migrations`);
    for (const name of found) console.log(name);
  } finally { rmSync(work, { recursive: true, force: true }); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) run().catch((e) => {
  // Only locally authored fixed labels escape. Never print API/CLI response or environment.
  const allowed = new Set(['arguments forbidden','qualified candidate must be 40 lowercase hex','config changed','unrecognized dry-run output','manual MAIN only','trusted workflow SHA missing','tooling not workflow SHA','repository mismatch','project mismatch','schema mode mismatch','required environment credential missing','read-only API inspection failed','DEV moved, requalify candidate','manifest changed','source inspection failed','migration set mismatch','migration bytes changed','unexpected ledger response','remote ledger changed','CLI read-only planning failed; raw output suppressed','CLI plan differs from reviewed forward set']);
  console.error(allowed.has(e.message) ? e.message : 'Read-only planning failed, details suppressed');
  // CLI output only, sanitized (sanitizeCliOutput); never API responses or the environment.
  if (allowed.has(e.message) && typeof e.sanitizedOutput === 'string') console.error(`Sanitized CLI output:\n${e.sanitizedOutput}`);
  process.exitCode = 1;
});
