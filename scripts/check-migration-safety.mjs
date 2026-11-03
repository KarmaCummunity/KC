#!/usr/bin/env node
/**
 * Flags destructive SQL in migration files (prod safety gate).
 * Per-line override: append `migration-safety: allow` on the same line.
 * `--release <base> <head>` is the stricter dev → main mode (see
 * checkReleaseMigrations), run by the release lane of CI.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DEFAULT_DIR = join(REPO_ROOT, 'supabase', 'migrations');

/** @type {{ id: string; re: RegExp; hint: string }[]} */
export const DESTRUCTIVE_RULES = [
  { id: 'drop-table', re: /\bDROP\s+TABLE\b/i, hint: 'DROP TABLE' },
  { id: 'drop-column', re: /\bDROP\s+COLUMN\b/i, hint: 'DROP COLUMN' },
  { id: 'truncate', re: /\bTRUNCATE\b/i, hint: 'TRUNCATE' },
  {
    id: 'delete-without-where',
    re: /\bDELETE\s+FROM\s+[a-z0-9_."]+\s*;/i,
    hint: 'DELETE FROM without WHERE',
  },
];

const ALLOW_MARKER = 'migration-safety: allow';

/**
 * `ALTER PUBLICATION <name> DROP TABLE <t>` only removes a table from a
 * logical-replication publication (e.g. `supabase_realtime`); no data is lost.
 * These clauses are stripped before the destructive rules run so a real
 * `DROP TABLE` elsewhere on the same line is still flagged.
 */
const PUBLICATION_DROP_TABLE = /\bALTER\s+PUBLICATION\s+[a-z0-9_."]+\s+DROP\s+TABLE\b/gi;

/** Dropping a session-scoped temp table (`pg_temp.*`) touches no persisted data. */
const TEMP_TABLE_DROP = /\bDROP\s+TABLE\s+(IF\s+EXISTS\s+)?pg_temp\.[a-z0-9_"]+/gi;

/**
 * @param {string} content
 * @param {string} filename
 * @param {{ honorAllow?: boolean }} [options] honorAllow=false scans marked lines too (release mode).
 */
export function scanMigrationSql(content, filename, { honorAllow = true } = {}) {
  const errors = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (honorAllow && line.includes(ALLOW_MARKER)) continue;

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;

    const commentIdx = line.indexOf('--');
    if (commentIdx >= 0) line = line.slice(0, commentIdx);

    const sql = line.replace(PUBLICATION_DROP_TABLE, '').replace(TEMP_TABLE_DROP, '').trim();
    if (!sql) continue;

    for (const rule of DESTRUCTIVE_RULES) {
      if (rule.re.test(sql)) {
        errors.push(`${filename}:${i + 1}: ${rule.hint} (rule ${rule.id})`);
      }
    }
  }

  return errors;
}

/**
 * @param {string} migrationsDir
 */
export function checkMigrationSafety(migrationsDir) {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const errors = [];
  for (const file of files) {
    const path = join(migrationsDir, file);
    const content = readFileSync(path, 'utf8');
    errors.push(...scanMigrationSql(content, file));
  }

  return { ok: errors.length === 0, errors };
}

/**
 * File names a release PR body justifies, one line each:
 *   Migration safety: 0450_drop_legacy.sql — <why this is safe, ≥ 10 chars>
 */
export function justifiedFiles(prBody) {
  const re = /^migration safety:\s*(\S+\.sql)\s*[—:-]\s*\S.{9,}$/gim;
  return new Set([...(prBody ?? '').matchAll(re)].map((m) => m[1]));
}

/**
 * Changes that keep the data but can break the code of the PREVIOUS release,
 * which keeps running until the new web and functions are live (and again
 * after a rollback). Expand/contract: add the new shape first, switch the
 * code, remove the old shape in a later release.
 */
export const COMPAT_RULES = [
  { id: 'rename', re: /\bRENAME\b/i, hint: 'RENAME' },
  { id: 'alter-column-type', re: /\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, hint: 'ALTER COLUMN … TYPE' },
  { id: 'set-not-null', re: /\bSET\s+NOT\s+NULL\b/i, hint: 'SET NOT NULL' },
  { id: 'drop-function', re: /\bDROP\s+FUNCTION\b/i, hint: 'DROP FUNCTION' },
  { id: 'drop-policy', re: /\bDROP\s+POLICY\b/i, hint: 'DROP POLICY' },
  { id: 'alter-policy', re: /\bALTER\s+POLICY\b/i, hint: 'ALTER POLICY' },
  { id: 'disable-rls', re: /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i, hint: 'DISABLE ROW LEVEL SECURITY' },
];

/** COMPAT_RULES hits in `content`, comments ignored. */
export function scanCompatibility(content, filename) {
  const hits = [];
  content.split('\n').forEach((line, i) => {
    const sql = line.replace(/--.*$/, '');
    for (const rule of COMPAT_RULES) {
      if (rule.re.test(sql)) hits.push(`${filename}:${i + 1}: ${rule.hint} (rule ${rule.id}, breaks the previous release unless expand/contract)`);
    }
  });
  return hits;
}

/**
 * Release (dev → main) mode, for the migrations a release adds or changes.
 * The one human approving the release must see why each risky change is
 * safe, so:
 *   • a destructive line (DESTRUCTIVE_RULES) needs its `migration-safety:
 *     allow` marker AND a justification line for its file in the PR body;
 *   • a compatibility-breaking line (COMPAT_RULES) needs the justification
 *     line for its file (the marker alone does not count).
 * @param {{ name: string, content: string }[]} files changed migration files
 * @param {string} prBody
 */
export function checkReleaseMigrations(files, prBody) {
  const justified = justifiedFiles(prBody);
  const errors = [];
  for (const { name, content } of files) {
    const ok = justified.has(name);
    const hits = [...scanMigrationSql(content, name, { honorAllow: ok }), ...(ok ? [] : scanCompatibility(content, name))];
    for (const hit of hits) {
      errors.push(`${hit}${ok ? '' : ` — add \`Migration safety: ${name} — <reason>\` to the release PR body`}`);
    }
  }
  return errors;
}

/** Migrations added or modified between `base` and `head` (merge-base diff). */
function changedMigrations(base, head) {
  const out = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '--diff-filter=AM', `${base}...${head}`, '--', 'supabase/migrations/*.sql'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return out.split('\n').filter(Boolean).map((path) => ({
    name: basename(path),
    content: readFileSync(join(REPO_ROOT, path), 'utf8'),
  }));
}

function releaseMain(base, head) {
  if (!base || !head) {
    console.error('usage: check-migration-safety.mjs --release <base-sha> <head-sha>  (PR body in $PR_BODY)');
    process.exit(2);
  }
  const files = changedMigrations(base, head);
  const errors = checkReleaseMigrations(files, process.env.PR_BODY);
  for (const err of errors) console.log(`::error::${err}`);
  if (errors.length) process.exit(1);
  console.log(`✓ Release migration scan passed — ${files.length} changed migration file(s).`);
}

function main() {
  if (process.argv[2] === '--release') return releaseMain(process.argv[3], process.argv[4]);
  const dir = process.argv[2] ?? DEFAULT_DIR;
  const result = checkMigrationSafety(dir);
  if (!result.ok) {
    console.error(
      `✗ Migration safety check failed (${result.errors.length} issue(s)):\n`
    );
    for (const err of result.errors) console.error(`  • ${err}`);
    console.error(
      '\nSplit into a backward-compatible migration, or add `migration-safety: allow` on the line with a PR justification.'
    );
    process.exit(1);
  }
  const count = readdirSync(dir).filter((f) => f.endsWith('.sql')).length;
  console.log(`✓ Migration safety check passed — ${count} files scanned.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
