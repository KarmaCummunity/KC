#!/usr/bin/env node
/**
 * Merge-time numbering of database migrations.
 *
 * Parallel PRs that each take "the next free number" collide: one PR was
 * renumbered three times in the merge queue, each time re-running CI. So a PR
 * never picks a number. It adds `supabase/migrations/next-NN_snake_slug.sql`,
 * where `NN` (01-99) only orders the PR's own files. After the merge into `dev`,
 * `assign` renames every pending file to the next free `NNNN_snake_slug.sql`
 * (.github/workflows/bump-version-on-merge.yml), in a commit CI certifies.
 *
 * CI jobs that need a runnable stack call `assign` on their throwaway checkout
 * first, so the pending files are tested under the numbers they will receive.
 *
 * Usage:
 *   node scripts/migration-ids.mjs check     pending names are well-formed and unique
 *   node scripts/migration-ids.mjs assign    rename pending files to their numbers
 *   node scripts/migration-ids.mjs restore   undo the last local `assign` (never needed in CI)
 *   node scripts/migration-ids.mjs list      print the pending files (exit 1 when any)
 * Env: MIGRATION_IDS_DIR - override the migrations directory (tests).
 *      MIGRATION_IDS_MAP - override where `assign` records its renames (tests).
 */
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const DEFAULT_DIR = join(repoRoot, 'supabase', 'migrations');
// Inside `.git`, so a local `assign` can be undone but its record is never committed.
const DEFAULT_MAP = join(repoRoot, '.git', 'kc-migration-ids.json');

/**
 * Numbers below this are handed out by hand (the retired claim table in
 * docs/agents/MIGRATION_RANGES.md), so automatic numbering starts here and
 * never reuses a number a branch may still hold.
 */
export const AUTO_ASSIGN_FLOOR = 50;

const PENDING_FILE = /^next-(\d{2})_([a-z0-9_]+)\.sql$/;
const NUMBERED_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/i;

/** True for a migration file still waiting for its number. */
export const isPending = (file) => PENDING_FILE.test(file);

/** The `.sql` files of a directory, in a stable order. */
function sqlFiles(dir) {
  return readdirSync(dir).filter((file) => file.endsWith('.sql')).sort();
}

/**
 * Names that look like pending files but do not match the contract, plus slugs
 * used twice. Two PRs adding the same slug would otherwise merge as two
 * migrations that do the same thing.
 * @param {string[]} files migration file names
 * @returns {string[]} human-readable errors; empty when valid
 */
export function pendingErrors(files) {
  const errors = [];
  const slugs = new Map();
  for (const file of files) {
    if (!file.startsWith('next-')) continue;
    const match = file.match(PENDING_FILE);
    if (!match) {
      errors.push(`invalid pending migration filename: ${file} (expected next-NN_snake_case.sql, NN = 01-99)`);
      continue;
    }
    if (match[1] === '00') errors.push(`${file}: the order prefix starts at 01`);
    if (slugs.has(match[2])) errors.push(`duplicate pending migration slug "${match[2]}": ${slugs.get(match[2])} and ${file}`);
    else slugs.set(match[2], file);
  }
  return errors;
}

/**
 * Decides the final name of every pending file: the next free number after the
 * highest numbered file (never below the auto-assign floor), in `NN` then slug
 * order, so one PR's files keep their relative order.
 * @param {string[]} files migration file names
 * @returns {{from: string, to: string}[]}
 */
export function planAssignments(files) {
  const errors = pendingErrors(files);
  if (errors.length > 0) throw new Error(errors.join('\n'));

  const highest = Math.max(
    AUTO_ASSIGN_FLOOR - 1,
    ...files.map((file) => file.match(NUMBERED_FILE)).filter(Boolean).map((match) => Number(match[1])),
  );
  const pending = files
    .map((file) => file.match(PENDING_FILE))
    .filter(Boolean)
    .sort((a, b) => a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));

  return pending.map((match, index) => {
    const number = highest + 1 + index;
    if (number > 9999) throw new Error('migration numbers exhausted (4 digits)');
    return { from: match[0], to: `${String(number).padStart(4, '0')}_${match[2]}.sql` };
  });
}

/**
 * Renames the pending files of `dir` in place and records the renames in `mapFile`.
 * @returns {{from: string, to: string}[]} the renames applied
 */
export function assign(dir = DEFAULT_DIR, mapFile = null) {
  const plan = planAssignments(sqlFiles(dir));
  for (const { from, to } of plan) renameSync(join(dir, from), join(dir, to));
  if (plan.length > 0 && mapFile) writeFileSync(mapFile, JSON.stringify(plan), 'utf8');
  return plan;
}

/** Undoes the renames recorded by the last `assign` that wrote `mapFile`. */
export function restore(dir = DEFAULT_DIR, mapFile = DEFAULT_MAP) {
  if (!existsSync(mapFile)) return [];
  const plan = JSON.parse(readFileSync(mapFile, 'utf8'));
  for (const { from, to } of plan) {
    // A file the user already renamed or deleted is left alone.
    if (existsSync(join(dir, to))) renameSync(join(dir, to), join(dir, from));
  }
  unlinkSync(mapFile);
  return plan;
}

function main() {
  const command = process.argv[2];
  const dir = process.env.MIGRATION_IDS_DIR || DEFAULT_DIR;
  const mapFile = process.env.MIGRATION_IDS_MAP || (existsSync(dirname(DEFAULT_MAP)) ? DEFAULT_MAP : null);
  try {
    if (command === 'check') {
      const errors = pendingErrors(sqlFiles(dir));
      if (errors.length > 0) throw new Error(errors.join('\n'));
      console.log(`Pending migrations OK (${sqlFiles(dir).filter(isPending).length} waiting for a number on merge).`);
    } else if (command === 'assign') {
      const plan = assign(dir, mapFile);
      for (const { from, to } of plan) console.log(`${from} -> ${to}`);
      if (plan.length === 0) console.log('No pending migrations to number.');
    } else if (command === 'restore') {
      for (const { from, to } of restore(dir, mapFile ?? DEFAULT_MAP)) console.log(`${to} -> ${from}`);
    } else if (command === 'list') {
      const pending = sqlFiles(dir).filter(isPending);
      pending.forEach((file) => console.log(file));
      process.exit(pending.length > 0 ? 1 : 0);
    } else {
      console.error('Usage: node scripts/migration-ids.mjs <check|assign|restore|list>');
      process.exit(2);
    }
  } catch (error) {
    console.error(`Migration numbering failed:\n${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
