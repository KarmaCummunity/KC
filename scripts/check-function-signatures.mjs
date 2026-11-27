#!/usr/bin/env node
/**
 * Stale function overload guard (KC#1722, TD-91 part b). Run by the static-guards lane
 * (.github/workflows/ci-static-guards.yml).
 *
 * Postgres identifies a function by its name and its input parameter types. A migration that
 * changes a function's parameter list with `create or replace function` does not replace it: it
 * adds a second function of that name, and the old one stays callable with its old body and its
 * old grants. The convention is to drop the old signature first, in the same migration
 * (e.g. 0052, 0085, 0091). This guard replays the migrations in order and fails when a migration
 * after the baseline adds a signature to a function that still has another one.
 *
 * An overload that is meant to exist is marked on the `create` line:
 *   create function public.foo(p_id uuid, p_limit integer) -- function-overload: allow <why>
 *
 * The baseline (0001_baseline.sql) only seeds the known signatures: its own overloads are reviewed
 * history. Archived migrations (supabase/migrations/archive/) take no part.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = join(__dirname, '..', 'supabase', 'migrations');
const BASELINE = '0001_baseline.sql';
const ALLOW_MARKER = /function-overload:\s*allow/i;

/** Type spellings Postgres treats as one type, mapped to a single canonical name. */
const TYPE_ALIASES = new Map([
  ['int', 'integer'], ['int4', 'integer'], ['int8', 'bigint'], ['int2', 'smallint'],
  ['bool', 'boolean'], ['float8', 'double precision'], ['float4', 'real'], ['decimal', 'numeric'],
  ['varchar', 'character varying'], ['char', 'character'],
  ['timestamp with time zone', 'timestamptz'], ['timestamp without time zone', 'timestamp'],
  ['time with time zone', 'timetz'], ['time without time zone', 'time'],
]);

/** First words of the built-in types that are written as more than one word. */
const MULTI_WORD_TYPE_STARTS = new Set(['double', 'timestamp', 'time', 'character', 'bit', 'interval']);

/** Parameter modes; OUT parameters are not part of a function's identity. */
const MODES = new Set(['in', 'out', 'inout', 'variadic']);

/**
 * Replaces comments with spaces, keeping every offset and line break, so a match in the result
 * maps back to its line in the original text. String and dollar-quoted bodies are left alone.
 */
export function blankComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, (line) => ' '.repeat(line.length));
}

/** Text between the parenthesis at `open` and its matching close, or null when unbalanced. */
function balancedArgs(sql, open) {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return { text: sql.slice(open + 1, i), end: i + 1 };
  }
  return null;
}

/** Splits a parameter list on its top-level commas (a `numeric(10,2)` keeps its comma). */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Canonical type of one parameter, or null for an OUT parameter (not part of the identity). */
function parameterType(param) {
  // A default is not part of the type: `p_limit integer default 20`, `p_at timestamptz = now()`.
  const words = param.replace(/\s+default\s[\s\S]*$/i, '').replace(/\s*=[\s\S]*$/, '').trim().split(/\s+/);
  const mode = words[0].toLowerCase();
  if (MODES.has(mode)) {
    if (mode === 'out') return null;
    words.shift();
  }
  // `p_id uuid`: the first word is a name unless the whole parameter is a multi-word type.
  if (words.length > 1 && !MULTI_WORD_TYPE_STARTS.has(words[0].toLowerCase())) words.shift();
  const type = words
    .join(' ')
    .toLowerCase()
    .replace(/"/g, '')
    .replace(/^(public|pg_catalog)\./, '')
    // A type modifier never tells two signatures apart: numeric(10,2) is numeric.
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ');
  const isArray = type.endsWith('[]');
  const base = isArray ? type.slice(0, -2).trim() : type;
  return (TYPE_ALIASES.get(base) ?? base) + (isArray ? '[]' : '');
}

/** The identity of a parameter list: its input types, comma separated (`uuid,integer`). */
export function signatureOf(argsText) {
  return splitTopLevel(argsText).map(parameterType).filter((t) => t !== null).join(',');
}

/** Qualified, lower-case function name; an unqualified name lives in `public`. */
function qualified(name) {
  const plain = name.replace(/"/g, '').toLowerCase();
  return plain.includes('.') ? plain : `public.${plain}`;
}

const NAME = String.raw`((?:"?[A-Za-z_][\w$]*"?\.)?"?[A-Za-z_][\w$]*"?)`;
const CREATE_RE = new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?function\s+${NAME}\s*\(`, 'gi');
const DROP_RE = /\bdrop\s+function\s+(?:if\s+exists\s+)?/gi;
const DROP_TARGET_RE = new RegExp(String.raw`^\s*${NAME}\s*`);

/**
 * The function statements of one migration, in file order: every `create` with its signature, and
 * every target of a `drop function` (a drop without a parameter list drops every signature).
 */
export function functionStatements(sql) {
  const code = blankComments(sql);
  const statements = [];
  for (const m of code.matchAll(CREATE_RE)) {
    const args = balancedArgs(code, m.index + m[0].length - 1);
    if (args) statements.push({ kind: 'create', at: m.index, name: qualified(m[1]), signature: signatureOf(args.text) });
  }
  for (const m of code.matchAll(DROP_RE)) {
    // `drop function a(uuid), b(text) cascade;` names several targets, separated by commas.
    let rest = code.slice(m.index + m[0].length);
    let offset = m.index + m[0].length;
    for (let target = DROP_TARGET_RE.exec(rest); target; target = DROP_TARGET_RE.exec(rest)) {
      const after = offset + target[0].length;
      const args = code[after] === '(' ? balancedArgs(code, after) : null;
      statements.push({ kind: 'drop', at: offset, name: qualified(target[1]), signature: args ? signatureOf(args.text) : null });
      const next = args ? args.end : after;
      const comma = /^\s*,/.exec(code.slice(next));
      if (!comma) break;
      offset = next + comma[0].length;
      rest = code.slice(offset);
    }
  }
  return statements.sort((a, b) => a.at - b.at);
}

/** 1-based line number of an offset. */
function lineAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

/** Applied migrations in order: numbered files first, then the pending `next-NN_*` files of a PR. */
export function migrationOrder(files) {
  const numbered = files.filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const pending = files
    .filter((f) => /^next-\d+_.*\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/^next-(\d+)/)[1]) - Number(b.match(/^next-(\d+)/)[1]));
  return [...numbered, ...pending];
}

/**
 * Replays `migrations` ([{ file, sql }], in apply order) and reports each create that adds a second
 * live signature to a function, unless its line carries the allow marker.
 */
export function checkFunctionSignatures(migrations) {
  const live = new Map(); // qualified name -> Set of signatures
  const errors = [];
  for (const { file, sql } of migrations) {
    const lines = sql.split('\n');
    for (const statement of functionStatements(sql)) {
      const signatures = live.get(statement.name) ?? new Set();
      live.set(statement.name, signatures);
      if (statement.kind === 'drop') {
        if (statement.signature === null) signatures.clear();
        else signatures.delete(statement.signature);
        continue;
      }
      if (signatures.has(statement.signature)) continue; // a plain `create or replace`
      const line = lineAt(sql, statement.at);
      const others = [...signatures];
      signatures.add(statement.signature);
      if (file === BASELINE || others.length === 0 || ALLOW_MARKER.test(lines[line - 1] ?? '')) continue;
      errors.push(
        `${file}:${line}: ${statement.name}(${statement.signature}) is created while ` +
          `${others.map((s) => `${statement.name}(${s})`).join(', ')} still exists. ` +
          `Drop the old signature first (drop function ${statement.name}(${others[0]});), ` +
          'or mark an intended overload with "-- function-overload: allow <reason>" on the create line.',
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Reads the migrations of `dir` (top level only, so `archive/` is skipped) in apply order. */
export function readMigrations(dir = DEFAULT_DIR) {
  return migrationOrder(readdirSync(dir)).map((file) => ({ file, sql: readFileSync(join(dir, file), 'utf8') }));
}

function main() {
  const migrations = readMigrations(process.argv[2] ?? DEFAULT_DIR);
  const result = checkFunctionSignatures(migrations);
  if (!result.ok) {
    console.error(`✗ Function signature check failed (${result.errors.length} issue(s)):\n`);
    for (const error of result.errors) console.error(`  • ${error}`);
    process.exit(1);
  }
  console.log(`✓ Function signature check passed — ${migrations.length} migrations, no stale overloads.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
