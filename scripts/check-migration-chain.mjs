#!/usr/bin/env node
// Run by the static-guards lane (.github/workflows/ci-static-guards.yml).
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = join(__dirname, '..', 'supabase', 'migrations');
const MIGRATION_RE = /^(\d{4})_[a-z0-9_]+\.sql$/i;

export function checkMigrationChain(migrationsDir) {
  const errors = [];
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const seen = new Map();

  for (const file of files) {
    const match = file.match(MIGRATION_RE);
    if (!match) {
      errors.push(`invalid migration filename: ${file} (expected NNNN_snake_case.sql)`);
      continue;
    }
    const prefix = match[1];
    if (seen.has(prefix)) {
      errors.push(
        `duplicate prefix ${prefix}: ${seen.get(prefix)} and ${file} (Alembic-style single-head violation)`
      );
    } else {
      seen.set(prefix, file);
    }
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const dir = process.argv[2] ?? DEFAULT_DIR;
  const result = checkMigrationChain(dir);
  if (!result.ok) {
    console.error(`✗ Migration chain check failed (${result.errors.length} issue(s)):\n`);
    for (const err of result.errors) console.error(`  • ${err}`);
    process.exit(1);
  }
  const count = readdirSync(dir).filter((f) => f.endsWith('.sql')).length;
  console.log(`✓ Migration chain check passed — ${count} files.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
