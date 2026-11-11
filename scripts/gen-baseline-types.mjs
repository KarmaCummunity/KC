#!/usr/bin/env node
// Generates the Supabase TypeScript types of the production baseline without Docker.
//
// `supabase gen types typescript --local` needs the Docker stack. That command is a thin
// wrapper: it starts the `supabase/postgres-meta` image and asks it for the types. This
// script runs the same generator (`@supabase/postgres-meta`, from npm) against a scratch
// database built from `supabase/baseline/0001_baseline.sql` on a plain local PostgreSQL
// server:
//
//   1. create an empty scratch database, apply the Supabase shim and the baseline
//      (the same three steps as scripts/run-baseline-tests.sh, without the tests)
//   2. run the generator for the exposed schema (`public`)
//   3. drop monthly partition children (scripts/strip-partition-types.mjs)
//   4. write app/packages/infrastructure-supabase/src/database.types.ts
//
// `database.types.ts` is the one generated file the app compiles against. Adapters that
// have not moved to the baseline yet import the frozen `database.legacy.types.ts`
// (docs/db/app-migration-playbook.md); that file is never regenerated.
//
// Usage: node scripts/gen-baseline-types.mjs [--check] [--no-build] [--stdout]
//   --check     generate and compare with the committed file; exit 1 on a difference
//   --no-build  use the scratch database as it is (for example right after
//               scripts/run-baseline-tests.sh, which leaves its database in place)
//   --stdout    print the types instead of writing the file
// Env:  DB_URL — admin connection URI of a LOCAL server; read from `supabase status` when unset.
//       BASELINE_SCRATCH_DB — scratch database name (default kc_baseline_types).
//       KC_PGMETA_DIR — where the generator is installed (default: a directory under the OS
//       temp dir, reused between runs).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripPartitionTypes } from './strip-partition-types.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT_FILE = join(ROOT, 'app/packages/infrastructure-supabase/src/database.types.ts');
const BASELINE = join(ROOT, 'supabase/baseline/0001_baseline.sql');
const SHIM = join(ROOT, 'supabase/baseline/local/supabase_shim.sql');

/** Schemas the API exposes; the only ones the client can address (target-design §2.1). */
export const EXPOSED_SCHEMAS = ['public'];

// The generator and its formatter are pinned: the formatter decides the layout of the
// file, so an unpinned one makes `--check` fail for reasons unrelated to the schema.
// 0.98.0 is the last release that formats with prettier, as the Supabase CLI pinned by
// .github/actions/setup-supabase-cli does; its output has the layout of database.types.ts.
export const GENERATOR = Object.freeze({ package: '@supabase/postgres-meta', version: '0.98.0', prettier: '3.6.2' });

const LOCAL_ADDRESS = /^(socket|127\.|::1$|172\.|192\.168\.|10\.)/;
const SCRATCH_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * @param {string[]} argv command-line arguments after the script name
 * @returns {{ check: boolean, build: boolean, stdout: boolean }}
 * @throws {Error} on an unknown flag
 */
export function parseArgs(argv) {
  const options = { check: false, build: true, stdout: false };
  for (const arg of argv) {
    if (arg === '--check') options.check = true;
    else if (arg === '--no-build') options.build = false;
    else if (arg === '--stdout') options.stdout = true;
    else throw new Error(`gen-baseline-types: unknown argument '${arg}'`);
  }
  return options;
}

/** True when `address` (as the server reports it, or `socket`) is a local one. */
export function isLocalAddress(address) {
  return LOCAL_ADDRESS.test(address);
}

/**
 * Connection URI of database `name` on the server of `adminUrl`.
 * @throws {Error} when the name is not a plain identifier (it is interpolated into DDL)
 */
export function scratchUrl(adminUrl, name) {
  if (!SCRATCH_NAME.test(name)) throw new Error(`gen-baseline-types: invalid scratch database name '${name}'`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * Checks that `source` has the layout `supabase gen types typescript` produces, for the
 * exposed schemas only. Returns the list of problems (empty = valid).
 * @param {string} source generated TypeScript
 * @param {string[]} [schemas] schemas that must be the only ones present
 * @returns {string[]}
 */
export function shapeProblems(source, schemas = EXPOSED_SCHEMAS) {
  const problems = [];
  if (!source.startsWith('export type Json =')) problems.push('does not start with the Json type');
  const database = /^export type Database = \{\n([\s\S]*?)^\}\n/m.exec(source);
  if (!database) return [...problems, 'no `export type Database` block'];
  const found = [...database[1].matchAll(/^ {2}([A-Za-z_]+): \{$/gm)].map((m) => m[1]);
  const expected = [...schemas].sort();
  if (found.filter((name) => name !== '__InternalSupabase').sort().join() !== expected.join()) {
    problems.push(`schemas are [${found.join(', ')}], expected [${expected.join(', ')}]`);
  }
  for (const schema of schemas) {
    const body = new RegExp(`^ {2}${schema}: \\{\\n([\\s\\S]*?)^ {2}\\}$`, 'm').exec(database[1]);
    const sections = body ? [...body[1].matchAll(/^ {4}([A-Za-z]+): /gm)].map((m) => m[1]) : [];
    const wanted = ['Tables', 'Views', 'Functions', 'Enums', 'CompositeTypes'];
    if (sections.join() !== wanted.join()) problems.push(`${schema} sections are [${sections.join(', ')}]`);
  }
  for (const part of ['Row: {', 'Insert: {', 'Update: {', 'Relationships: [', 'Args: ', 'Returns: ']) {
    if (!source.includes(part)) problems.push(`no '${part}' anywhere`);
  }
  for (const helper of ['Tables', 'TablesInsert', 'TablesUpdate', 'Enums', 'CompositeTypes']) {
    if (!source.includes(`export type ${helper}<`)) problems.push(`helper type ${helper} is missing`);
  }
  if (!/^export const Constants = \{$/m.test(source)) problems.push('Constants object is missing');
  if (/_y\d{4}m(0[1-9]|1[0-2]): \{$/m.test(source)) problems.push('a monthly partition child table is present');
  return problems;
}

/** First differing line between two texts, for the `--check` message. */
export function firstDifference(expected, actual) {
  const a = expected.split('\n');
  const b = actual.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return { line: i + 1, expected: a[i] ?? '<end of file>', actual: b[i] ?? '<end of file>' };
  }
  return null;
}

function psql(url, args) {
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8' });
}

function adminUrl() {
  if (process.env.DB_URL) return process.env.DB_URL;
  const status = spawnSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  const match = /^DB_URL="(.*)"$/m.exec(status.stdout ?? '');
  if (!match) throw new Error('gen-baseline-types: no DB_URL and no running local stack');
  return match[1];
}

/** Drops and recreates the scratch database, then applies the shim and the baseline. */
function buildScratch(admin, name, target) {
  const address = psql(admin, ['-Atc', "select coalesce(host(inet_server_addr()), 'socket')"]).trim();
  if (!isLocalAddress(address)) throw new Error(`gen-baseline-types: refusing non-local server '${address}'`);
  psql(admin, ['-c', `drop database if exists ${name} with (force)`, '-c', `create database ${name}`]);
  psql(target, ['-f', SHIM]);
  psql(target, ['--single-transaction', '-f', BASELINE]);
}

/** Installs the pinned generator once and returns the path of its entry script. */
function ensureGenerator() {
  const dir = process.env.KC_PGMETA_DIR ?? join(tmpdir(), `kc-pgmeta-${GENERATOR.version}-prettier-${GENERATOR.prettier}`);
  const entry = join(dir, 'node_modules', GENERATOR.package, 'dist/server/server.js');
  if (existsSync(entry)) return entry;
  mkdirSync(dir, { recursive: true });
  const manifest = {
    name: 'kc-pgmeta',
    private: true,
    dependencies: { [GENERATOR.package]: GENERATOR.version, prettier: GENERATOR.prettier },
    overrides: { prettier: GENERATOR.prettier },
  };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: 'inherit' });
  return entry;
}

/** Runs the generator against `target` and returns the types of the exposed schemas. */
function generate(target) {
  const result = spawnSync(process.execPath, [ensureGenerator()], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: {
      ...process.env,
      PG_META_DB_URL: target,
      PG_META_GENERATE_TYPES: 'typescript',
      PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS: EXPOSED_SCHEMAS.join(','),
      NODE_NO_WARNINGS: '1',
    },
  });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`gen-baseline-types: generator failed (${result.status})\n${result.stderr}`);
  }
  return stripPartitionTypes(result.stdout);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const admin = adminUrl();
  const target = scratchUrl(admin, process.env.BASELINE_SCRATCH_DB ?? 'kc_baseline_types');
  if (options.build) buildScratch(admin, new URL(target).pathname.slice(1), target);
  const types = generate(target);
  const problems = shapeProblems(types);
  if (problems.length > 0) throw new Error(`gen-baseline-types: unexpected output shape:\n- ${problems.join('\n- ')}`);
  if (options.stdout) return process.stdout.write(types);
  if (!options.check) {
    writeFileSync(OUTPUT_FILE, types);
    return console.log(`gen-baseline-types: wrote ${OUTPUT_FILE}`);
  }
  const committed = existsSync(OUTPUT_FILE) ? readFileSync(OUTPUT_FILE, 'utf8') : '';
  const difference = firstDifference(committed, types);
  if (!difference) return console.log('gen-baseline-types: database.types.ts is up to date');
  console.error(
    `gen-baseline-types: database.types.ts is out of date (line ${difference.line}).\n` +
      `  committed: ${difference.expected}\n  generated: ${difference.actual}\n` +
      'Run: node scripts/gen-baseline-types.mjs',
  );
  process.exitCode = 1;
  return undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
