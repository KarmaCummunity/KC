#!/usr/bin/env node
// D-228 prod schema-source guard: supabase db push to kc-prod is refused unless
// an explicit KC_PROD_SCHEMA_MODE matches the migration set. Default = block.
//
// Modes (GitHub Actions variable KC_PROD_SCHEMA_MODE on supabase-prod):
//   unset / empty / "block" — refuse (the default; do not set the variable)
//   baseline — allow only the filenames listed in
//              supabase/baseline/prod-allowed-migrations.txt
//   legacy   — allow the current supabase/migrations/ tree as an explicit
//              exception to D-228 (Path A replay of the incremental chain)
//
// This script never talks to Supabase and never writes. It is called from
// deploy-preflight (prod) and again in deploy-db before the dry-run.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_REL = 'supabase/baseline/prod-allowed-migrations.txt';
export const MIGRATIONS_REL = 'supabase/migrations';
export const MODES = new Set(['block', 'baseline', 'legacy']);

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string | undefined} raw */
export function normalizeProdSchemaMode(raw) {
  const mode = String(raw ?? '').trim().toLowerCase();
  return mode === '' ? 'block' : mode;
}

/** Basenames of *.sql files in supabase/migrations, sorted. */
export function listMigrationFiles(root) {
  const dir = join(root, MIGRATIONS_REL);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/** Approved basenames from the D-228 manifest (comments and blanks ignored). */
export function parseAllowedManifest(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

export function loadAllowedManifest(root) {
  return parseAllowedManifest(readFileSync(join(root, MANIFEST_REL), 'utf8'));
}

/**
 * Reasons prod db push must not run. Empty = allowed (legacy, or baseline with
 * an exact manifest match). `mode` is the already-normalized value.
 */
export function checkProdSchemaMode({ mode, migrations, allowed }) {
  const files = [...migrations];
  const approved = new Set(allowed);
  const errors = [];
  const warnings = [];

  if (!MODES.has(mode)) {
    errors.push(
      `KC_PROD_SCHEMA_MODE=${mode} is not a recognized mode (D-228). Use unset/block (default), baseline, or legacy.`,
    );
    return { ok: false, errors, warnings };
  }

  if (mode === 'block') {
    errors.push(
      `PROD db push is blocked (D-228). KC_PROD_SCHEMA_MODE is unset/block (the default). ` +
        `kc-prod must be built from the new single baseline, not by replaying ` +
        `${files.length} file(s) in supabase/migrations. Set the supabase-prod variable ` +
        `KC_PROD_SCHEMA_MODE to "baseline" only after ${MANIFEST_REL} lists the approved ` +
        `cut-over migration(s), or to "legacy" only as an explicit exception.`,
    );
    return { ok: false, errors, warnings };
  }

  if (mode === 'legacy') {
    warnings.push(
      `KC_PROD_SCHEMA_MODE=legacy: allowing supabase db push of ${files.length} migration(s) ` +
        `to PROD as an explicit exception to D-228 (new single baseline).`,
    );
    return { ok: true, errors, warnings };
  }

  // baseline
  const unexpected = files.filter((name) => !approved.has(name));
  const missing = [...approved].filter((name) => !files.includes(name)).sort();
  if (unexpected.length) {
    const examples = unexpected.slice(0, 8).join(', ');
    const more = unexpected.length > 8 ? ` … (+${unexpected.length - 8} more)` : '';
    errors.push(
      `KC_PROD_SCHEMA_MODE=baseline, but supabase/migrations contains ${unexpected.length} ` +
        `file(s) not listed in ${MANIFEST_REL} (D-228). Examples: ${examples}${more}. ` +
        `Remove legacy migrations or update the approved manifest after cut-over.`,
    );
  }
  if (missing.length) {
    errors.push(
      `KC_PROD_SCHEMA_MODE=baseline, but ${MANIFEST_REL} lists ${missing.length} ` +
        `file(s) that are not in supabase/migrations: ${missing.slice(0, 8).join(', ')}.`,
    );
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function loadProdSchemaContext({ root = DEFAULT_ROOT, env = process.env } = {}) {
  return {
    mode: normalizeProdSchemaMode(env.KC_PROD_SCHEMA_MODE),
    migrations: listMigrationFiles(root),
    allowed: loadAllowedManifest(root),
  };
}

function main() {
  const result = checkProdSchemaMode(loadProdSchemaContext());
  for (const w of result.warnings) console.log(`::warning title=D-228 prod schema mode::${w}`);
  for (const e of result.errors) console.log(`::error title=D-228 prod schema mode::${e}`);
  if (!result.ok) process.exit(1);
  console.log('PROD schema mode allows db push.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.log(`::error title=D-228 prod schema mode::${err.message}`);
    process.exit(1);
  }
}
