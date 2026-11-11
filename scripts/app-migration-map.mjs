#!/usr/bin/env node
// Renders the application migration map: for every database object the code addresses
// today (scripts/db-usage-inventory.mjs) the replacement in the production baseline.
//
//   authored   scripts/app-migration-map.rows.mjs   one row per old object: status, target, note
//   derived    call sites (inventory), old signature (database.legacy.types.ts), new signature
//              (database.types.ts), error codes and client grants (supabase/schemas)
//   output     docs/db/app-migration-map.json   every row with everything derived
//              docs/db/app-migration-map.md     the same, for people
//
// The script fails when an inventory object has no row, a row names an object the code no
// longer uses, or a row points at a baseline object that does not exist — so the map cannot
// drift from the code or from the baseline unnoticed.
//
// Usage: node scripts/app-migration-map.mjs [--check]

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInventory } from './db-usage-inventory.mjs';
import { renderMarkdown } from './app-migration-map.render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES_DIR = join(ROOT, 'app/packages/infrastructure-supabase/src');
export const JSON_FILE = join(ROOT, 'docs/db/app-migration-map.json');
export const MD_FILE = join(ROOT, 'docs/db/app-migration-map.md');
export const STATUSES = ['same', 'renamed', 'changed', 'removed', 'missing'];
const ONE_TO_ONE = new Set(['same', 'renamed']);

/** The value that starts at `text[start]`: a balanced `{…}` (with `[]`), or a bare type. */
function readValue(text, start) {
  if (text[start] !== '{') return /^[^;}]*?(?=\s*(?:;|\}|SetofOptions:|$))/.exec(text.slice(start))[0].trim();
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}' && (depth -= 1) === 0) return text.slice(start, text.startsWith('[]', i + 1) ? i + 3 : i + 1);
  }
  return text.slice(start);
}

function fields(objectText) {
  const out = {};
  const inner = objectText.replace(/^\{\s*/, '').replace(/\s*\}(\[\])?$/, '');
  for (const part of inner.split(/;\s+|\s+(?=[a-z0-9_]+\??: )/)) {
    const m = /^([a-z0-9_]+\??): (.+)$/.exec(part.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Parses `supabase gen types` output: tables and views (columns of `Row`) and functions
 * (one entry per overload: `args` by name, `returns` as text).
 */
export function parseTypes(source) {
  const result = { tables: {}, views: {}, functions: {} };
  const end = source.indexOf('\ntype DatabaseWithoutInternals');
  const database = end === -1 ? source : source.slice(0, end);
  const sections = [...database.matchAll(/^ {4}(Tables|Views|Functions|Enums|CompositeTypes): /gm)];
  sections.forEach((head, n) => {
    const body = database.slice(head.index, sections[n + 1]?.index ?? database.length);
    const entries = [...body.matchAll(/^ {6}([a-z0-9_]+):/gm)];
    entries.forEach((entry, e) => {
      const text = body.slice(entry.index, entries[e + 1]?.index ?? body.length).replace(/\s+/g, ' ');
      if (head[1] === 'Tables' || head[1] === 'Views') {
        const row = text.indexOf('Row: ');
        result[head[1].toLowerCase()][entry[1]] = { columns: row === -1 ? [] : Object.keys(fields(readValue(text, row + 5))) };
      } else if (head[1] === 'Functions') {
        result.functions[entry[1]] = [...text.matchAll(/Args: /g)].map((m) => {
          const args = readValue(text, m.index + 6);
          const returns = text.indexOf('Returns: ', m.index);
          return { args: args === 'never' ? {} : fields(args), returns: readValue(text, returns + 9) };
        });
      }
    });
  });
  return result;
}

function walkSql(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSql(full, out);
    else if (name.endsWith('.sql')) out.push(full);
  }
  return out;
}

/**
 * Reads the baseline sources: per public function its source file and the messages it can
 * raise (its own and those of the `kc_private` functions it calls, transitively), and per
 * public table what `authenticated` is granted.
 */
export function parseBaselineSql(files) {
  const bodies = {};
  const where = {};
  const grants = {};
  const fn = /create (?:or replace )?function ((?:public|kc_private|kc_access)\.[a-z0-9_]+)\s*\([\s\S]*?\$\$([\s\S]*?)\$\$/gi;
  for (const { path, sql } of files) {
    for (const m of sql.matchAll(fn)) {
      bodies[m[1]] = {
        errors: [...m[2].matchAll(/raise exception '([a-z0-9_]+)'/g)].map((e) => e[1]),
        calls: [...m[2].matchAll(/\b((?:kc_private|kc_access|public)\.[a-z0-9_]+)\s*\(/g)].map((c) => c[1]),
      };
      where[m[1]] = `${path}:${sql.slice(0, m.index).split('\n').length}`;
    }
    for (const m of sql.matchAll(/grant\s+([^;]+?)\s+on\s+(?:table\s+)?public\.([a-z0-9_]+)\s+to\s+([^;]+);/gi)) {
      if (!/\bauthenticated\b/.test(m[3])) continue;
      const table = (grants[m[2]] ??= {});
      for (const part of m[1].split(/,(?![^(]*\))/)) {
        const priv = /^\s*(select|insert|update|delete)\s*(?:\(([^)]*)\))?/i.exec(part);
        if (priv) table[priv[1].toLowerCase()] = priv[2] ? priv[2].split(',').map((c) => c.trim()).sort() : true;
      }
    }
  }
  const errorsOf = (name, seen = new Set()) => {
    if (seen.has(name) || !bodies[name]) return [];
    seen.add(name);
    return [...bodies[name].errors, ...bodies[name].calls.flatMap((call) => errorsOf(call, seen))];
  };
  const functions = {};
  for (const name of Object.keys(bodies).filter((n) => n.startsWith('public.'))) {
    functions[name.slice(7)] = { source: where[name], errors: [...new Set(errorsOf(name))].sort() };
  }
  return { functions, grants };
}

/** `fn(p_a: string, p_b?: number) → returns`, with a long return type cut. */
export function signature(name, overloads, tables = {}) {
  return overloads.map(({ args, returns }) => {
    const list = Object.entries(args).map(([k, v]) => `${k}: ${v.replace(/Database\["public"\]\["(?:Enums|CompositeTypes)"\]\["(\w+)"\]/g, '$1')}`);
    let shape = returns.replace(/Database\["public"\]\["(?:Enums|CompositeTypes)"\]\["(\w+)"\]/g, '$1');
    if (shape.startsWith('{')) {
      const keys = Object.keys(fields(shape)).map((k) => k.replace('?', '')).sort().join();
      const row = Object.entries(tables).find(([, t]) => [...t.columns].sort().join() === keys);
      if (row) shape = `${row[0]} row${shape.endsWith('[]') ? '[]' : ''}`;
    }
    if (shape.length > 220) shape = `${shape.slice(0, 217)}...`;
    return `${name}(${list.join(', ')}) → ${shape}`;
  });
}

function loadAppErrorCodes() {
  const roots = ['app/packages/infrastructure-supabase/src', 'app/packages/application/src', 'app/packages/domain/src', 'app/apps/mobile/src', 'app/apps/mobile/app'];
  const text = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === 'node_modules' || name === '__tests__') continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|json)$/.test(name) && !/\.test\.|database\./.test(name)) text.push(readFileSync(full, 'utf8'));
    }
  };
  roots.forEach((root) => walk(join(ROOT, root)));
  const all = text.join('\n');
  return (code) => new RegExp(`['"\`.]${code}['"\`:]`).test(all) || new RegExp(`\\b${code}\\b`).test(all);
}

/** Joins the authored rows with everything derived and validates the result. */
export function buildMap({ rows, missing, packages, edgeFunctions, notes, launchTier = () => 'core' }, inventory, oldTypes, newTypes, baseline, knowsCode = () => true) {
  const problems = [];
  const used = new Map();
  for (const entry of inventory.entries) {
    const key = `${entry.kind}:${entry.name}`;
    if (!used.has(key)) used.set(key, []);
    used.get(key).push(entry);
  }
  const missingIds = new Set(missing.map((m) => m.id));
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.kind}:${row.old}`;
    if (seen.has(key)) problems.push(`duplicate row ${key}`);
    seen.add(key);
    if (!STATUSES.includes(row.status)) problems.push(`${key}: unknown status '${row.status}'`);
    const sites = used.get(key);
    if (!sites) {
      problems.push(`${key}: not used by the code any more (remove the row)`);
      continue;
    }
    if (row.status === 'missing' && !missingIds.has(row.missing)) problems.push(`${key}: missing id '${row.missing}' is not in the MISSING list`);
    const needsTarget = !['removed', 'missing'].includes(row.status);
    if (needsTarget !== row.to.length > 0) problems.push(`${key}: status '${row.status}' and targets [${row.to.join(', ')}] disagree`);
    const targets = row.to.map((target) => {
      const [type, name] = [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)];
      if (type === 'rpc') {
        if (!newTypes.functions[name]) problems.push(`${key}: target function '${name}' is not in the baseline`);
        const info = baseline.functions[name] ?? { errors: [] };
        return {
          type, name, source: info.source,
          signature: signature(name, newTypes.functions[name] ?? [], newTypes.tables),
          errors: info.errors.map((code) => ({ code, knownToApp: knowsCode(code) })),
        };
      }
      if (type === 'table') {
        if (!newTypes.tables[name]) problems.push(`${key}: target table '${name}' is not in the baseline`);
        return { type, name, columns: newTypes.tables[name]?.columns ?? [], clientGrants: baseline.grants[name] ?? {} };
      }
      if (!['topic', 'bucket', 'edge', 'client', 'sql'].includes(type)) problems.push(`${key}: unknown target type '${type}'`);
      return { type, name };
    });
    const oldObject = oldTypes.functions[row.old] && row.kind === 'rpc'
      ? { signature: signature(row.old, oldTypes.functions[row.old], oldTypes.tables) }
      : (oldTypes.tables[row.old] ?? oldTypes.views[row.old]) && row.kind === 'table'
        ? { columns: (oldTypes.tables[row.old] ?? oldTypes.views[row.old]).columns, isView: Boolean(oldTypes.views[row.old]) }
        : {};
    const areas = [...new Set(sites.map((s) => s.area))].sort();
    out.push({
      old: row.old, kind: row.kind, status: row.status, launch: launchTier(row, areas), confidence: row.confidence, missing: row.missing ?? null,
      note: row.note, oldObject, targets,
      areas,
      callSites: sites.map(({ file, line, symbol, area, ops, event }) => ({ file, line, symbol, area, ...(ops ? { ops } : {}), ...(event ? { event } : {}) })),
    });
  }
  for (const key of used.keys()) if (!seen.has(key)) problems.push(`${key}: used by the code but has no row`);

  const modules = {};
  for (const row of out) {
    for (const site of row.callSites) {
      const m = (modules[site.area] ??= { callSites: 0, oneToOne: 0, changed: 0, removed: 0, missing: 0 });
      m.callSites += 1;
      m[ONE_TO_ONE.has(row.status) ? 'oneToOne' : row.status] += 1;
    }
  }
  const totals = {};
  const launchTotals = {};
  const tally = (bucket, key, row) => {
    const t = (bucket[key] ??= { objects: 0, same: 0, renamed: 0, changed: 0, removed: 0, missing: 0 });
    t.objects += 1;
    t[row.status] += 1;
  };
  for (const row of out) {
    tally(totals, row.kind, row);
    tally(launchTotals, row.launch, row);
  }
  // A MISSING entry is as urgent as its most launch-critical row, unless it states its tier.
  const rank = { core: 0, wedge: 1, later: 2 };
  const missingOut = missing.map((m) => {
    const tiers = out.filter((r) => r.missing === m.id).map((r) => r.launch).sort((a, b) => rank[a] - rank[b]);
    if (tiers.length === 0) problems.push(`MISSING ${m.id} has no row`);
    const tier = m.tier ?? tiers[0] ?? 'later';
    return { ...m, tier, blocker: tier !== 'later' && m.action === 'build' };
  }).sort((a, b) => Number(b.blocker) - Number(a.blocker) || rank[a.tier] - rank[b.tier] || a.id.localeCompare(b.id));
  const packagesOut = packages.map(({ select, ...p }) => {
    const mine = out.filter(select);
    const count = (...statuses) => mine.filter((r) => statuses.includes(r.status)).length;
    return { ...p, rows: mine.map((r) => `${r.kind}:${r.old}`), counts: { objects: mine.length, oneToOne: count('same', 'renamed'), changed: count('changed'), removed: count('removed'), missing: count('missing') } };
  });
  const owners = new Map();
  for (const p of packagesOut) for (const key of p.rows) owners.set(key, [...(owners.get(key) ?? []), p.id]);
  for (const row of out) if (!owners.has(`${row.kind}:${row.old}`)) problems.push(`${row.kind}:${row.old}: no work package implements it`);
  return {
    map: {
      generatedBy: 'scripts/app-migration-map.mjs', totals, launchTotals, modules: Object.fromEntries(Object.entries(modules).sort()),
      notes, missing: missingOut, packages: packagesOut, edgeFunctions, rows: out.sort((a, b) => a.kind.localeCompare(b.kind) || a.old.localeCompare(b.old)),
    },
    problems,
  };
}

async function main() {
  const authored = await import('./app-migration-map.rows.mjs');
  const oldTypes = parseTypes(readFileSync(join(TYPES_DIR, 'database.legacy.types.ts'), 'utf8'));
  const newTypes = parseTypes(readFileSync(join(TYPES_DIR, 'database.types.ts'), 'utf8'));
  const schemas = join(ROOT, 'supabase/schemas');
  const baseline = parseBaselineSql(walkSql(schemas).map((full) => ({ path: full.slice(schemas.length + 1), sql: readFileSync(full, 'utf8') })));
  const { map, problems } = buildMap(authored, buildInventory(), oldTypes, newTypes, baseline, loadAppErrorCodes());
  if (problems.length > 0) {
    console.error(`app-migration-map: ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  const json = `${JSON.stringify(map, null, 1)}\n`;
  const md = renderMarkdown(map);
  if (!process.argv.includes('--check')) {
    writeFileSync(JSON_FILE, json);
    writeFileSync(MD_FILE, md);
    console.log(`app-migration-map: wrote ${map.rows.length} rows`);
    return;
  }
  const stale = [[JSON_FILE, json], [MD_FILE, md]].filter(([file, text]) => !existsSync(file) || readFileSync(file, 'utf8') !== text);
  if (stale.length === 0) return void console.log('app-migration-map: up to date');
  console.error('app-migration-map: docs/db/app-migration-map.{json,md} are stale. Run: node scripts/app-migration-map.mjs');
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
