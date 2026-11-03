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

function loadCorpus(repoRoot) {
  const migrationsDir = join(repoRoot, 'supabase/migrations');
  const migrationSql = existsSync(migrationsDir)
    ? readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => readFileSync(join(migrationsDir, f), 'utf8'))
        .join('\n')
    : '';
  const typesFile = join(repoRoot, 'app/packages/infrastructure-supabase/src/database.types.ts');
  const types = existsSync(typesFile) ? readFileSync(typesFile, 'utf8') : '';
  return (migrationSql + '\n' + types).toLowerCase();
}

export function checkRpcContract({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const allowlistPath = join(repoRoot, 'scripts/check-rpc-contract.allowlist.json');
  const allowlist = existsSync(allowlistPath)
    ? JSON.parse(readFileSync(allowlistPath, 'utf8'))
    : { rpcs: [], tables: [] };
  const infraDir = join(repoRoot, 'app/packages/infrastructure-supabase/src');
  const corpus = loadCorpus(repoRoot);
  const errors = [];

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
      errors.push(`RPC '${rpc}' used in infrastructure-supabase but not found in migrations or database.types.ts`);
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
      errors.push(`Table '${table}' used in infrastructure-supabase but not found in migrations or database.types.ts`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const result = checkRpcContract();
  if (!result.ok) {
    console.error(`✗ RPC contract check failed (${result.errors.length} issue(s)):\n`);
    for (const err of result.errors) console.error(`  • ${err}`);
    process.exit(1);
  }
  console.log('✓ RPC contract check passed.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
