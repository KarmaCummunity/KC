#!/usr/bin/env node
// Inventory of every database / platform object the application code addresses by name:
//   table            `.from('<table>')`                     (with the operations chained on it)
//   rpc              `.rpc('<fn>')`, also multi-line and through wrappers (`rpc(fn, …)`)
//   bucket           `.storage.from('<bucket>')`
//   channel          `.channel(<topic>)` and `openExactTopicChannel(client, <topic>, …)`
//   postgres_changes `.on('postgres_changes', { table: … })`
//   edge_function    `.functions.invoke('<name>')`
// across the Supabase adapters, the mobile app and the Edge Functions. It is the input of
// docs/db/app-migration-map.{md,json}: every name listed here needs a row in the map.
//
// Usage: node scripts/db-usage-inventory.mjs            write docs/db/app-usage-inventory.json
//        node scripts/db-usage-inventory.mjs --check    fail when the committed file is stale
//        node scripts/db-usage-inventory.mjs --summary  print the totals only

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT_FILE = join(ROOT, 'docs/db/app-usage-inventory.json');
export const SCAN_ROOTS = [
  'app/packages/infrastructure-supabase/src',
  'app/apps/mobile/src',
  'app/apps/mobile/app',
  'supabase/functions',
];
const SKIP_DIRS = new Set(['__tests__', 'node_modules', '__mocks__']);
const SKIP_FILES = /(\.test\.tsx?|_test\.ts|\.d\.ts|database(\.baseline)?\.types\.ts)$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const TABLE_OPS = ['select', 'insert', 'update', 'upsert', 'delete'];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !SKIP_FILES.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Replaces comments with spaces (newlines kept, so offsets and line numbers hold) while
 * leaving string and template literals untouched.
 */
export function blankComments(source) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') out += source[(i += 1)] ?? '';
      else if (ch === quote) quote = null;
      i += 1;
    } else if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') (out += ' '), (i += 1);
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** Splits the argument list that starts right after an opening parenthesis at `start`. */
export function readArgs(text, start) {
  const args = [];
  let depth = 0;
  let quote = null;
  let from = start;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      if (depth === 0) return [...args, text.slice(from, i).trim()].filter((arg, n) => arg !== '' || n === 0);
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      args.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  return args;
}

/** String literals in an expression: `'a'`, `cond ? 'a' : 'b'`, `'a' as never`. */
export function literalsIn(expression) {
  return [...expression.matchAll(/(['"])([A-Za-z_][\w.:-]*)\1/g)].map((m) => m[2]);
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

const DECLARATION =
  /^(\s*)(?:export\s+)?(?:default\s+)?(?:(?:public|private|protected|static|readonly|async|override)\s+)*(?:function\s*\*?\s*([\w$]+)|(?:const|let)\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|<|function|[\w$]+\s*=>)|([\w$]+)\s*(?:<[^>]*>)?\([^;]*$)/;
const NOT_A_NAME = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'else', 'new', 'super']);

/** `Class.method`, `function` or `<module>` that encloses line `line` (1-based). */
export function enclosingSymbol(lines, line) {
  const indentOf = (text) => text.length - text.trimStart().length;
  let limit = lines[line - 1].trim() === '' ? Infinity : indentOf(lines[line - 1]);
  let fn = null;
  for (let i = line - 2; i >= 0; i -= 1) {
    const text = lines[i];
    if (text.trim() === '' || indentOf(text) >= limit) continue;
    const cls = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([\w$]+)/.exec(text);
    if (cls) return fn ? `${cls[1]}.${fn}` : cls[1];
    const decl = DECLARATION.exec(text);
    const name = decl && (decl[2] ?? decl[3] ?? decl[4]);
    if (name && !NOT_A_NAME.has(name)) {
      fn ??= name;
      limit = indentOf(text);
    }
    if (indentOf(text) === 0 && fn) return fn;
  }
  return fn ?? '<module>';
}

/** Module the call site belongs to: adapter folder, `mobile` or `fn:<edge function>`. */
export function areaOf(file) {
  const infra = /^app\/packages\/infrastructure-supabase\/src\/(?:([^/]+)\/)?/.exec(file);
  if (infra) return infra[1] ?? '(root)';
  const fn = /^supabase\/functions\/([^/]+)\//.exec(file);
  if (fn) return `fn:${fn[1]}`;
  return 'mobile';
}

function tableOps(text, after) {
  const end = text.indexOf(';', after);
  const chain = text.slice(after, end === -1 ? after + 2000 : Math.min(end, after + 2000));
  return TABLE_OPS.filter((op) => new RegExp(`\\.${op}\\(`).test(chain));
}

/** Parameter names of the declaration that encloses `index`, with their type annotation. */
function enclosingParams(text, index) {
  const head = text.slice(0, index);
  const matches = [...head.matchAll(/(?:function\s+([\w$]+)|(?:const|let)\s+([\w$]+)\s*=\s*(?:async\s*)?|(?:async\s+)?([\w$]+)\s*(?:<[^>]*>)?)\(/g)];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const m = matches[i];
    const name = m[1] ?? m[2] ?? m[3];
    if (NOT_A_NAME.has(name)) continue;
    const params = readArgs(text, m.index + m[0].length).map((param) => {
      const [, id, type] = /^(?:(?:private|public|protected|readonly)\s+)*([\w$]+)\??\s*(?::\s*([\s\S]+?))?(?:\s*=.*)?$/.exec(param) ?? [];
      return { id, type: type?.trim() };
    });
    if (params.some((p) => p.id)) return { name, params };
  }
  return null;
}

/**
 * Scans the files and returns the inventory entries, sorted by file and line.
 * @param {{ path: string, text: string }[]} files repo-relative path and source of each file
 */
export function scanSources(files) {
  const sources = files.map((file) => ({ ...file, code: blankComments(file.text) }));
  // `const NAME = 'literal'` and `type Name = 'a' | 'b'` anywhere in the scanned code.
  const constants = new Map();
  const unions = new Map();
  for (const { code, path } of sources) {
    for (const m of code.matchAll(/\b(?:const|let)\s+([\w$]+)\s*(?::\s*string)?\s*=\s*(['"])([\w.:-]+)\2/g)) {
      constants.set(`${path}#${m[1]}`, m[3]);
      if (!constants.has(m[1])) constants.set(m[1], m[3]);
    }
    for (const m of code.matchAll(/\btype\s+([\w$]+)\s*=\s*((?:\s*\|?\s*(['"])[\w.:-]+\3)+)\s*;/g)) {
      unions.set(`${path}#${m[1]}`, literalsIn(m[2]));
      if (!unions.has(m[1])) unions.set(m[1], literalsIn(m[2]));
    }
  }
  const entries = [];
  const wrappers = [];
  const resolveNames = (expression, source, at) => {
    const literals = literalsIn(expression);
    if (literals.length > 0) return { names: literals, via: 'literal' };
    const id = expression.replace(/\s+as\s+[\w$]+$/, '');
    if (!IDENT.test(id)) return { names: [], via: 'unresolved' };
    const value = constants.get(`${source.path}#${id}`) ?? constants.get(id);
    if (value) return { names: [value], via: 'const' };
    const owner = enclosingParams(source.code, at);
    const position = owner?.params.findIndex((p) => p.id === id) ?? -1;
    if (position === -1) return { names: [], via: 'unresolved' };
    const type = owner.params[position].type ?? '';
    const union = unions.get(`${source.path}#${type}`) ?? unions.get(type);
    if (union) return { names: union, via: 'type-union' };
    wrappers.push({ name: owner.name, position, source });
    return { names: [], via: 'wrapper' };
  };
  // A channel topic is usually a template; when the call passes a variable, show what it holds.
  const topicOf = (expression, source, at) => {
    if (!IDENT.test(expression)) return expression;
    const local = [...source.code.slice(0, at).matchAll(new RegExp(`\\b(?:const|let)\\s+${expression}\\s*=\\s*([^;\\n]+)`, 'g'))].pop();
    const value = local?.[1].trim() ?? constants.get(expression);
    return value ? `${expression} = ${value}` : expression;
  };
  const add = (source, index, kind, expression, extra = {}) => {
    const line = lineOf(source.code, index);
    const { names, via } =
      kind === 'channel' ? { names: [topicOf(expression, source, index)], via: 'expression' } : resolveNames(expression, source, index);
    const base = { kind, file: source.path, line, area: areaOf(source.path), symbol: enclosingSymbol(source.lines, line), via, ...extra };
    if (names.length === 0 && via !== 'wrapper') entries.push({ ...base, name: `<${expression.slice(0, 60)}>` });
    for (const name of names) entries.push({ ...base, name });
  };
  for (const source of sources) {
    source.lines = source.code.split('\n');
    const { code } = source;
    for (const m of code.matchAll(/\.from\(/g)) {
      const [first] = readArgs(code, m.index + m[0].length);
      if (!first || /^\w+\s*:/.test(first)) continue; // Array.from / Buffer.from are filtered below
      const before = code.slice(Math.max(0, m.index - 40), m.index);
      if (/\bstorage\s*$/.test(before)) add(source, m.index, 'bucket', first);
      else if (/\b(?:Array|Buffer|Uint8Array|Object|Set|Map)\s*$/.test(before) || !/^['"`]|^[A-Z_][A-Z0-9_]*$/.test(first)) continue;
      else add(source, m.index, 'table', first, { ops: tableOps(code, m.index) });
    }
    for (const m of code.matchAll(/(?<![\w$])(?:[\w$]+(?:\.[\w$]+)*\.)?rpc\(/g)) {
      const prefix = code.slice(Math.max(0, m.index - 12), m.index);
      const [first] = readArgs(code, m.index + m[0].length);
      if (!first || /\bfunction\s+$/.test(prefix) || /^[\w$]+\??\s*:/.test(first)) continue; // a declaration
      add(source, m.index, 'rpc', first);
    }
    for (const m of code.matchAll(/\.channel\(|\bopenExactTopicChannel\(/g)) {
      const args = readArgs(code, m.index + m[0].length);
      const topic = m[0].startsWith('.') ? args[0] : args[1];
      if (topic && !/^[\w$]+\??\s*:/.test(topic)) add(source, m.index, 'channel', topic.replace(/\s+/g, ' '));
    }
    for (const m of code.matchAll(/(['"])postgres_changes\1\s*,\s*\{([^}]*)\}/g)) {
      const table = /table:\s*(['"])([\w.]+)\1/.exec(m[2])?.[2];
      const event = /event:\s*(['"])([\w*]+)\1/.exec(m[2])?.[2] ?? '*';
      if (table) add(source, m.index, 'postgres_changes', `'${table}'`, { event });
    }
    for (const m of code.matchAll(/\.functions\s*\.invoke(?:<[\s\S]*?>)?\(/g)) {
      const [first] = readArgs(code, m.index + m[0].length);
      if (first) add(source, m.index, 'edge_function', first);
    }
  }
  // Calls of a wrapper (`runOwnerAction(client, 'pause_my_listing', …)`) carry the RPC name.
  for (const wrapper of new Map(wrappers.map((w) => [`${w.source.path}#${w.name}#${w.position}`, w])).values()) {
    if (wrapper.name === 'rpc') continue; // `rpc('name')` is already matched directly
    const callers = sources.filter((s) => s === wrapper.source || new RegExp(`import[^;]*\\b${wrapper.name}\\b`).test(s.code));
    for (const source of callers) {
      for (const m of source.code.matchAll(new RegExp(`(?<![\\w$])(?:this\\.)?${wrapper.name}\\(`, 'g'))) {
        const arg = readArgs(source.code, m.index + m[0].length)[wrapper.position];
        const line = lineOf(source.code, m.index);
        for (const name of arg ? literalsIn(arg) : []) {
          entries.push({ kind: 'rpc', name, file: source.path, line, area: areaOf(source.path), symbol: enclosingSymbol(source.lines, line), via: `wrapper:${wrapper.name}` });
        }
      }
    }
  }
  const order = (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
  return entries.sort(order);
}

/** Totals per kind: call sites and distinct names. */
export function summarize(entries) {
  const summary = {};
  for (const entry of entries) {
    const row = (summary[entry.kind] ??= { callSites: 0, names: new Set() });
    row.callSites += 1;
    row.names.add(entry.name);
  }
  return Object.fromEntries(Object.entries(summary).sort().map(([kind, row]) => [kind, { callSites: row.callSites, distinct: row.names.size }]));
}

export function buildInventory(root = ROOT) {
  const files = SCAN_ROOTS.flatMap((dir) => walk(join(root, dir))).map((full) => ({
    path: relative(root, full).replaceAll('\\', '/'),
    text: readFileSync(full, 'utf8'),
  }));
  const entries = scanSources(files);
  return { generatedBy: 'scripts/db-usage-inventory.mjs', roots: SCAN_ROOTS, summary: summarize(entries), entries };
}

function main() {
  const inventory = buildInventory();
  const text = `${JSON.stringify(inventory, null, 1)}\n`;
  if (process.argv.includes('--summary')) return console.log(JSON.stringify(inventory.summary, null, 2));
  if (!process.argv.includes('--check')) {
    writeFileSync(OUTPUT_FILE, text);
    return console.log(`db-usage-inventory: wrote ${relative(ROOT, OUTPUT_FILE)} (${inventory.entries.length} call sites)`);
  }
  if (existsSync(OUTPUT_FILE) && readFileSync(OUTPUT_FILE, 'utf8') === text) return console.log('db-usage-inventory: up to date');
  console.error('db-usage-inventory: docs/db/app-usage-inventory.json is stale. Run: node scripts/db-usage-inventory.mjs');
  process.exitCode = 1;
  return undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
