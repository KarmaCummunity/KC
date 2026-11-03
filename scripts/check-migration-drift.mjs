#!/usr/bin/env node
// Guard: the dev Supabase migration ledger must contain no version that lacks a
// matching local migration file.
//
// Why this exists: the repo uses SEQUENTIAL migration files (`NNNN_snake.sql`,
// e.g. `0212_glowe_event_registration.sql`). The Supabase MCP `apply_migration`
// tool, however, records TIMESTAMP-format versions (e.g. `20260701130827`) in
// `supabase_migrations.schema_migrations`. `supabase db push` refuses to run
// when the remote history has a version with no matching local file ("Remote
// migration versions not found in local migrations directory"), so every
// MCP-applied migration silently breaks the next `DB deploy` run on `dev` until
// someone runs `supabase migration repair`.
//
// This guard reads `supabase migration list --linked` output (piped in or a
// file path) and fails the moment the remote ledger contains a version that has
// no local `supabase/migrations/*.sql` file — catching the drift immediately
// instead of at deploy time, and printing the exact repair commands.
//
// Companion: `scripts/reconcile-migration-drift.mjs` runs the CLI itself and
// emits the same repair commands. Convention it enforces lives in
// docs/SSOT/OPERATOR_RUNBOOK.md ("Migration application rules") + CLAUDE.md §9.

import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

// A committed migration file: 4-digit sequential prefix + snake_case name.
const LOCAL_FILE_RE = /^(\d{4})_[a-z0-9_]+\.sql$/i;
// A version recorded by MCP `apply_migration`: 14-digit YYYYMMDDHHMMSS.
const TIMESTAMP_VERSION_RE = /^\d{14}$/;

/**
 * Parse the REMOTE column out of `supabase migration list --linked` output.
 * The table looks like:
 *
 *        LOCAL | REMOTE         | TIME (UTC)
 *       -------|----------------|--------------------
 *        0212  | 0212           | 0212
 *              | 20260701130827 | 2026-07-01 13:08:27
 *
 * We keep only all-digit REMOTE cells, which skips the header ("REMOTE") and the
 * dashed separator row while capturing both sequential and timestamp versions.
 * @param {string} cliOutput
 * @returns {string[]}
 */
export function parseRemoteVersions(cliOutput) {
  const versions = [];
  for (const line of cliOutput.split('\n')) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 2) continue;
    const remote = cells[1];
    if (/^\d+$/.test(remote)) versions.push(remote);
  }
  return versions;
}

/**
 * Sequential versions of the committed migration files (the 4-digit prefixes).
 * @param {string} migrationsDir
 * @returns {string[]}
 */
export function readLocalVersions(migrationsDir) {
  return readdirSync(migrationsDir)
    .map((f) => f.match(LOCAL_FILE_RE))
    .filter(Boolean)
    .map((m) => m[1]);
}

/**
 * Compare the remote ledger against local files.
 * - `orphans`  — remote versions with NO local file → these break `db push`.
 * - `timestampOrphans` — the subset that are MCP timestamp versions (the usual
 *   cause) — surfaced separately for a sharper error message.
 * - `missing`  — local files not yet in the remote ledger. Normal for a freshly
 *   committed migration (deploy will apply it); NOT a failure on its own, but
 *   paired with orphans it tells the reconcile helper what to mark `applied`.
 * @param {{ localVersions: string[]; remoteVersions: string[] }} input
 */
export function findDrift({ localVersions, remoteVersions }) {
  const local = new Set(localVersions);
  const remote = new Set(remoteVersions);
  const orphans = [...remote].filter((v) => !local.has(v)).sort();
  const timestampOrphans = orphans.filter((v) => TIMESTAMP_VERSION_RE.test(v));
  const missing = [...local].filter((v) => !remote.has(v)).sort();
  return { orphans, timestampOrphans, missing, ok: orphans.length === 0 };
}

/**
 * Build the copy-pasteable `supabase migration repair` block that reconciles
 * the ledger: revert each orphan, then mark each paired local file applied.
 * @param {{ orphans: string[]; missing: string[] }} drift
 * @returns {string[]}
 */
export function repairCommands({ orphans, missing }) {
  const cmds = [];
  for (const v of orphans) cmds.push(`supabase migration repair --status reverted ${v}`);
  for (const v of missing) cmds.push(`supabase migration repair --status applied ${v}`);
  return cmds;
}

function readCliOutput(fileArg) {
  // Explicit file path wins; otherwise read piped stdin (fd 0).
  return readFileSync(fileArg ?? 0, 'utf8');
}

/**
 * Local migrations the remote ledger does not have yet: what `db push` is
 * about to apply. The deploy pipeline records this count before applying so
 * a failed release after a schema change skips the automatic code rollback.
 * @param {string} cliOutput `supabase migration list --linked` output
 * @param {string[]} localVersions
 */
export function pendingMigrations(cliOutput, localVersions) {
  return findDrift({ localVersions, remoteVersions: parseRemoteVersions(cliOutput) }).missing;
}

function main() {
  const fileArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const cliOutput = readCliOutput(fileArg);

  const remoteVersions = parseRemoteVersions(cliOutput);
  if (remoteVersions.length === 0) {
    console.error(
      '✗ Could not parse any remote migration versions from the input.\n' +
        '  Expected `supabase migration list --linked` output (piped in or a file path arg).',
    );
    process.exit(2);
  }

  const localVersions = readLocalVersions(DEFAULT_MIGRATIONS_DIR);
  // --count-pending: report how many migrations `db push` will apply (deploy-db.yml).
  if (process.argv.includes('--count-pending')) {
    const line = `pending=${pendingMigrations(cliOutput, localVersions).length}`;
    console.log(line);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
    return;
  }
  const drift = findDrift({ localVersions, remoteVersions });

  if (drift.ok) {
    console.log(
      `✓ No migration drift — ${remoteVersions.length} remote versions all map to local files.`,
    );
    return;
  }

  const tsCount = drift.timestampOrphans.length;
  console.error(
    `✗ Migration drift detected: ${drift.orphans.length} remote version(s) have no local file` +
      (tsCount ? ` (${tsCount} MCP timestamp version(s))` : '') +
      '.\n',
  );
  for (const v of drift.orphans) {
    const kind = TIMESTAMP_VERSION_RE.test(v) ? 'MCP timestamp' : 'unknown';
    console.error(`  • ${v} (${kind}) — not found in supabase/migrations/`);
  }
  console.error(
    '\nRoot cause: a schema change was applied to dev via the Supabase MCP ' +
      '`apply_migration`\ntool (records a timestamp version) instead of `supabase db push` from a\n' +
      'committed sequential file. This breaks the next `DB deploy` run.\n' +
      'See docs/SSOT/OPERATOR_RUNBOOK.md → "Migration application rules" and CLAUDE.md §9.\n' +
      '\nReconcile the ledger (does not touch schema — only the history table):',
  );
  for (const cmd of repairCommands(drift)) console.error(`  ${cmd}`);
  console.error(
    '\nOr run: node scripts/reconcile-migration-drift.mjs   (emits these commands after re-linking).',
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
