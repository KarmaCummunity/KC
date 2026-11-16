#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = join(__dirname, '..');

// `\s*` spans newlines, so a call split across lines (`.rpc(\n  'name'`) is still found.
export const RPC_RE = /\.rpc\(\s*['"]([a-z_][a-z0-9_]*)['"]/g;
const TABLE_RE = /\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]/g;
const SKIP_DIRS = new Set(['__tests__', 'node_modules']);

function walkTsFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkTsFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

export function collectSymbols(rootDir, regex) {
  const symbols = new Set();
  for (const file of walkTsFiles(rootDir)) {
    const content = readFileSync(file, 'utf8');
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(content)) !== null) symbols.add(m[1]);
  }
  return symbols;
}

/**
 * The `.sql` files under `dir`; with `recursive`, those of its subdirectories too (the
 * baseline sources are nested by module).
 */
function listSqlFiles(dir, { recursive = false } = {}, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (recursive) listSqlFiles(full, { recursive }, out);
    } else if (entry.endsWith('.sql')) out.push(full);
  }
  return out;
}

// What the database declares: the migrations applied in order (`0001_baseline.sql` and the
// forward-only files after it; `archive/` is the retired chain and never counts), the
// baseline schema sources (`supabase/schemas`), the generated types, and the dev-only demo-data
// tools (`supabase/seed/demo`, FR-ADMIN-031): installed on kc-dev by the seed workflow, never a
// migration, so the production baseline stays free of demo objects.
function loadCorpus(repoRoot) {
  const sqlFiles = [
    ...listSqlFiles(join(repoRoot, 'supabase/migrations')),
    ...listSqlFiles(join(repoRoot, 'supabase/schemas'), { recursive: true }),
    ...listSqlFiles(join(repoRoot, 'supabase/seed/demo'), { recursive: true }),
  ];
  const sql = sqlFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  const typesFile = join(repoRoot, 'app/packages/infrastructure-supabase/src/database.types.ts');
  const types = existsSync(typesFile) ? readFileSync(typesFile, 'utf8') : '';
  return (sql + '\n' + types).toLowerCase();
}

/**
 * Objects the adapters still address although the baseline has no (or a differently shaped)
 * equivalent, and which the migration map files under launch tier `later`: they sit behind
 * flags that stay off at launch. Anything of a launch tier (core, wedge) must exist.
 * @returns {{ rpcs: Set<string>, tables: Set<string> }}
 */
export function deferredObjects(repoRoot) {
  const file = join(repoRoot, 'docs/db/app-migration-map.json');
  const out = { rpcs: new Set(), tables: new Set() };
  if (!existsSync(file)) return out;
  for (const row of JSON.parse(readFileSync(file, 'utf8')).rows ?? []) {
    if (row.launch !== 'later' || ['same', 'renamed'].includes(row.status)) continue;
    if (row.kind === 'rpc') out.rpcs.add(row.old);
    if (row.kind === 'table') out.tables.add(row.old);
  }
  return out;
}

export function checkRpcContract({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const allowlistPath = join(repoRoot, 'scripts/check-rpc-contract.allowlist.json');
  const allowlist = existsSync(allowlistPath)
    ? JSON.parse(readFileSync(allowlistPath, 'utf8'))
    : { rpcs: [], tables: [] };
  const infraDir = join(repoRoot, 'app/packages/infrastructure-supabase/src');
  const corpus = loadCorpus(repoRoot);
  const deferred = deferredObjects(repoRoot);
  const errors = [];
  const tolerated = [];

  for (const rpc of collectSymbols(infraDir, RPC_RE)) {
    if (allowlist.rpcs.includes(rpc)) continue;
    const needle = rpc.toLowerCase();
    const patterns = [
      `function public.${needle}`,
      `function ${needle}(`,
      `'${needle}':`,
      `"${needle}":`,
    ];
    if (!patterns.some((p) => corpus.includes(p))) {
      if (deferred.rpcs.has(rpc)) {
        tolerated.push(`rpc ${rpc}`);
        continue;
      }
      errors.push(`RPC '${rpc}' used in infrastructure-supabase but not found in migrations, supabase/schemas or database.types.ts`);
    }
  }

  for (const table of collectSymbols(infraDir, TABLE_RE)) {
    if (allowlist.tables.includes(table)) continue;
    const needle = table.toLowerCase();
    const patterns = [
      `public.${needle}`,
      `'${needle}':`,
      `"${needle}":`,
      `from('${needle}')`,
      `create table ${needle}`,
      `create or replace view ${needle}`,
      `create view ${needle}`,
    ];
    if (!patterns.some((p) => corpus.includes(p))) {
      if (deferred.tables.has(table)) {
        tolerated.push(`table ${table}`);
        continue;
      }
      errors.push(`Table '${table}' used in infrastructure-supabase but not found in migrations, supabase/schemas or database.types.ts`);
    }
  }

  return { ok: errors.length === 0, errors, tolerated };
}

function main() {
  const result = checkRpcContract();
  if (!result.ok) {
    console.error(`✗ RPC contract check failed (${result.errors.length} issue(s)):\n`);
    for (const err of result.errors) console.error(`  • ${err}`);
    process.exit(1);
  }
  const note = result.tolerated.length
    ? ` (${result.tolerated.length} object(s) of launch tier "later" are not in the baseline yet: docs/db/app-migration-map.md)`
    : '';
  console.log(`✓ RPC contract check passed${note}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
