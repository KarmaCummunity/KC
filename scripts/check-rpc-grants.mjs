#!/usr/bin/env node
// check-rpc-grants — every RPC the app calls must be executable by a client role.
//
// Functions in `public` are private by default (migration 0520): a new function gets
// EXECUTE for service_role only, and a migration grants `authenticated` / `anon`
// explicitly (ADR-002). This guard catches a client RPC whose migration forgot that
// grant, which would otherwise surface only at runtime as a 42501 in the app.
//
// It scans the code that runs with the user's session (the Supabase adapters and the
// mobile app), then asks the database which of those functions a client role can call.
// Calls whose name is computed at runtime (`.rpc(fn)`) are not seen.
//
// Usage: DB_URL=postgresql://… node scripts/check-rpc-grants.mjs
// Read-only: the only statement it runs is a catalog SELECT.
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPC_RE, collectSymbols } from './check-rpc-contract.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = join(__dirname, '..');

// Directories whose code calls Supabase with the end user's JWT.
const CLIENT_SOURCE_DIRS = ['app/packages/infrastructure-supabase/src', 'app/apps/mobile'];

// One row per RPC name: whether any overload in `public` is executable by a client role.
// The names arrive as a psql variable, so no value is ever spliced into the SQL text.
const GRANTS_QUERY = `
select p.proname,
       bool_or(has_function_privilege('authenticated', p.oid, 'execute')
            or has_function_privilege('anon', p.oid, 'execute'))
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname = any (string_to_array(:'rpc_names', ','))
 group by p.proname`;

/** Returns the sorted, de-duplicated RPC names called from client-side code. */
export function collectClientRpcs({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const names = new Set();
  for (const dir of CLIENT_SOURCE_DIRS) {
    for (const name of collectSymbols(join(repoRoot, dir), RPC_RE)) names.add(name);
  }
  return [...names].sort();
}

/** Parses `psql -At -F'|'` output (`name|t` / `name|f`) into a name → callable map. */
export function parseGrantRows(output) {
  const callable = new Map();
  for (const line of output.split('\n')) {
    const [name, flag] = line.trim().split('|');
    if (name) callable.set(name, flag === 't');
  }
  return callable;
}

/** Lists one error per RPC that is missing from the database or not client-callable. */
export function findUngrantedRpcs(rpcNames, callable) {
  const errors = [];
  for (const name of rpcNames) {
    if (!callable.has(name)) {
      errors.push(`RPC '${name}' is called by the app but no function public.${name} exists`);
    } else if (!callable.get(name)) {
      errors.push(
        `RPC '${name}' is called by the app but neither authenticated nor anon may EXECUTE it — ` +
          `add "grant execute on function public.${name}(…) to authenticated;" to its migration`,
      );
    }
  }
  return errors;
}

function queryGrants(dbUrl, rpcNames) {
  return execFileSync(
    'psql',
    [dbUrl, '-v', 'ON_ERROR_STOP=1', '-v', `rpc_names=${rpcNames.join(',')}`, '-At', '-F', '|', '-f', '-'],
    { input: GRANTS_QUERY, encoding: 'utf8' },
  );
}

function main() {
  const dbUrl = process.env.DB_URL;
  if (!dbUrl) {
    console.error('check-rpc-grants: set DB_URL to the database to inspect (e.g. the local stack)');
    process.exit(2);
  }
  const rpcNames = collectClientRpcs();
  const errors = findUngrantedRpcs(rpcNames, parseGrantRows(queryGrants(dbUrl, rpcNames)));
  if (errors.length > 0) {
    console.error(`✗ RPC grant check failed (${errors.length} issue(s)):\n`);
    for (const err of errors) console.error(`  • ${err}`);
    process.exit(1);
  }
  console.log(`✓ RPC grant check passed — ${rpcNames.length} client RPCs are executable by a client role.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
