#!/usr/bin/env node
/**
 * One source of truth for notification kinds.
 *
 * The registry of kinds is SQL vocabulary (`insert into kc_private.notification_kinds …
 * values …` under supabase/schemas/). The app (type `NotificationKind`, routes, channels),
 * the push worker (`dispatch-notification`) and the tests all need the same list, so this
 * script derives it and writes three generated files:
 *
 *   app/packages/domain/src/notificationKinds.generated.ts          the list, for the app
 *   supabase/functions/dispatch-notification/kinds.generated.ts     the same list, for the worker
 *   supabase/functions/dispatch-notification/strings.he.generated.json
 *       the Hebrew texts of the kinds, copied from the app's locale module — the worker
 *       renders push text from the same strings the app shows
 *
 * It reads the SQL source, not a database, so `--check` runs in a static CI lane. That is
 * only sound because the registry is written as literal `values` rows: any other statement
 * that writes the registry (a computed insert, an update, a delete) stops the script.
 * `--db-url <uri>` additionally compares the parsed list with a database built from the
 * baseline (needs `psql`).
 *
 *   node scripts/generate-notification-kinds.mjs            write the generated files
 *   node scripts/generate-notification-kinds.mjs --check    fail when one is stale or a kind lacks a piece
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = 'supabase/functions/dispatch-notification';
export const PATHS = {
  schemas: 'supabase/schemas',
  locale: 'app/apps/mobile/src/i18n/locales/he/modules/notifications.ts',
  domain: 'app/packages/domain/src/notificationKinds.generated.ts',
  worker: `${WORKER_DIR}/kinds.generated.ts`,
  strings: `${WORKER_DIR}/strings.he.generated.json`,
};

/** Arguments a notification text may interpolate; both renderers provide exactly these. */
export const TEXT_ARGS = ['actorName', 'count', 'othersCount', 'messagePreview'];
/** Texts the worker needs besides the kinds' own (fallbacks of the arguments above). */
export const AUXILIARY_KEYS = ['notifications.messagePreviewFallback', 'notifications.actorNameFallback'];
const KEY_PREFIX = 'notifications.';
const COLUMN_DEFAULTS = {
  default_enabled: true, bypass_preferences: false, bypass_quiet_hours: false, sends_push: true, group_window: null,
};
const REQUIRED_COLUMNS = ['kind', 'category', 'title_key', 'body_key'];
const INTERVAL_UNITS = { second: 1, minute: 60, hour: 3600, day: 86400 };

/** SQL text without `--` comments; string literals are kept intact. */
export function stripSqlComments(sql) {
  let out = '';
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (!inString && ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === "'") inString = !inString;
    out += ch;
  }
  return out;
}

function parseIntervalSeconds(text, where) {
  const match = /^(\d+)\s+(second|minute|hour|day)s?$/.exec(text.trim());
  if (!match) throw new Error(`${where}: unsupported interval '${text}' (use "<n> second|minute|hour|day")`);
  return Number(match[1]) * INTERVAL_UNITS[match[2]];
}

/** One SQL value of a registry row: a string, a boolean, null or `interval '…'` (seconds). */
function parseValue(token, where) {
  const text = token.trim();
  if (text === 'true' || text === 'false') return text === 'true';
  if (text === 'null') return null;
  const interval = /^interval\s+'([^']*)'$/.exec(text);
  if (interval) return parseIntervalSeconds(interval[1], where);
  const string = /^'((?:[^']|'')*)'$/.exec(text);
  if (string) return string[1].replaceAll("''", "'");
  throw new Error(`${where}: unsupported value ${text} — registry rows must be literals`);
}

/** Splits `a, 'b, c', d` on the commas outside string literals. */
function splitTopLevel(text) {
  const parts = [];
  let current = '';
  let inString = false;
  for (const ch of text) {
    if (ch === "'") inString = !inString;
    if (ch === ',' && !inString) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  return parts;
}

/** The rows of one `insert … (columns) values (…), (…)` statement. */
function parseInsert(statement, where) {
  const match = /^insert\s+into\s+kc_private\.notification_kinds\s*\(([^)]*)\)\s*values\s*([\s\S]*)$/i.exec(statement.trim());
  if (!match) {
    throw new Error(`${where}: the kind registry is written by a statement that is not ` +
      '`insert into kc_private.notification_kinds (…) values (…)` with literal rows. ' +
      'Write the rows out so the kind list can be generated without a database.');
  }
  const columns = match[1].split(',').map((c) => c.trim());
  const rows = [];
  const tuplePattern = /\(((?:[^()']|'(?:[^']|'')*')*)\)/g;
  // Anything left between the tuples (a function call, a sub-select) is not a literal row.
  if (match[2].replace(tuplePattern, '').replace(/[\s,]/g, '') !== '') {
    throw new Error(`${where}: registry rows must be literal tuples (no expressions)`);
  }
  for (const tuple of match[2].matchAll(tuplePattern)) {
    const values = splitTopLevel(tuple[1]);
    if (values.length !== columns.length) throw new Error(`${where}: a row has ${values.length} values for ${columns.length} columns`);
    const row = { ...COLUMN_DEFAULTS };
    columns.forEach((column, i) => {
      row[column] = parseValue(values[i], `${where} (${column})`);
    });
    rows.push(row);
  }
  if (rows.length === 0) throw new Error(`${where}: no literal rows found`);
  return rows;
}

/** Every kind registered by one SQL file. */
export function parseRegistrySql(sql, where = 'sql') {
  const kinds = [];
  for (const statement of stripSqlComments(sql).split(';')) {
    const writesRegistry = /\b(insert\s+into|update|delete\s+from|merge\s+into)\s+kc_private\.notification_kinds\b/i.test(statement);
    if (!writesRegistry) continue;
    // A statement inside a function body (dollar quoting) is code, not vocabulary.
    if (statement.includes('$$')) throw new Error(`${where}: the kind registry is written from a function body`);
    kinds.push(...parseInsert(statement, where));
  }
  return kinds;
}

function sqlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sqlFiles(path);
      return entry.name.endsWith('.sql') ? [path] : [];
    });
}

/** The registry as written under supabase/schemas, in path order. */
export function readRegistry(root = ROOT) {
  const kinds = [];
  for (const file of sqlFiles(join(root, PATHS.schemas))) {
    kinds.push(...parseRegistrySql(readFileSync(file, 'utf8'), relative(root, file)));
  }
  return kinds;
}

/** The string map of the Hebrew notifications locale module (a plain object literal). */
export function parseLocaleModule(source) {
  const start = source.indexOf('{', source.indexOf('export const'));
  const end = source.lastIndexOf('} as const');
  if (start < 0 || end < 0) throw new Error('locale module: expected `export const … = { … } as const`');
  return new Function(`return (${source.slice(start, end + 1)});`)();
}

const placeholders = (text) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
const localeKey = (key) => (key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : null);
const groupedKey = (bodyKey) => bodyKey.replace(/Body$/, 'GroupedBody');

/** One kind with everything derived from its row and its texts; problems go to `errors`. */
function describeKind(row, locale, errors) {
  const fail = (message) => errors.push(`kind ${row.kind}: ${message}`);
  for (const column of REQUIRED_COLUMNS) if (typeof row[column] !== 'string') fail(`column ${column} is missing`);
  if (!['critical', 'social'].includes(row.category)) fail(`unknown category ${row.category}`);
  const groupedBodyKey = row.group_window === null ? null : groupedKey(String(row.body_key));
  const textArgs = new Set();
  for (const key of [row.title_key, row.body_key, groupedBodyKey]) {
    if (key === null) continue;
    const text = localeKey(String(key)) === null ? undefined : locale[localeKey(String(key))];
    if (typeof text !== 'string' || text === '') {
      fail(`text ${key} is missing in ${PATHS.locale}` + (key === groupedBodyKey ? ' (a kind with a group window needs its grouped body)' : ''));
      continue;
    }
    for (const arg of placeholders(text)) {
      if (!TEXT_ARGS.includes(arg)) fail(`text ${key} uses {{${arg}}}; only ${TEXT_ARGS.join(', ')} are provided`);
      textArgs.add(arg);
    }
  }
  return {
    kind: row.kind, category: row.category, defaultEnabled: row.default_enabled,
    bypassPreferences: row.bypass_preferences, bypassQuietHours: row.bypass_quiet_hours,
    sendsPush: row.sends_push, groupWindowSeconds: row.group_window,
    titleKey: row.title_key, bodyKey: row.body_key, groupedBodyKey,
    textArgs: TEXT_ARGS.filter((arg) => textArgs.has(arg)),
  };
}

/** Builds the contents of the generated files, or throws naming every missing piece. */
export function build(rows, locale) {
  const errors = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.kind)) errors.push(`kind ${row.kind}: registered twice`);
    seen.add(row.kind);
  }
  const kinds = rows.map((row) => describeKind(row, locale, errors));
  for (const key of AUXILIARY_KEYS) if (typeof locale[localeKey(key)] !== 'string') errors.push(`text ${key} is missing in ${PATHS.locale}`);
  if (errors.length > 0) throw new Error(`notification kinds are incomplete:\n  - ${errors.join('\n  - ')}`);

  const stringKeys = [...new Set([...kinds.flatMap((k) => [k.titleKey, k.bodyKey, k.groupedBodyKey]), ...AUXILIARY_KEYS])]
    .filter((key) => key !== null).sort();
  const strings = Object.fromEntries(stringKeys.map((key) => [key, locale[localeKey(key)]]));
  const module = renderModule(kinds);
  return { kinds, files: { [PATHS.domain]: module, [PATHS.worker]: module, [PATHS.strings]: `${JSON.stringify(strings, null, 2)}\n` } };
}

function renderModule(kinds) {
  const entry = (k) => {
    const { kind, ...spec } = k;
    return `  ${kind}: ${JSON.stringify(spec).replaceAll('"', "'").replaceAll(/([{,])'(\w+)':/g, '$1 $2: ').replace(/}$/, ' }').replaceAll("','", "', '")},`;
  };
  return [
    '// GENERATED by scripts/generate-notification-kinds.mjs from the kind registry in',
    '// supabase/schemas (kc_private.notification_kinds) and the Hebrew locale. Do not edit:',
    '// change the SQL rows or the locale strings and run the script again.',
    '',
    '/** Arguments a notification text may interpolate. */',
    `export const NOTIFICATION_TEXT_ARGS = [${TEXT_ARGS.map((a) => `'${a}'`).join(', ')}] as const;`,
    '',
    '/** Every notification kind with its rules, as registered in the database. */',
    'export const NOTIFICATION_KINDS = {',
    ...kinds.map(entry),
    '} as const;',
    '',
  ].join('\n');
}

/** The registry of a database built from the baseline, in the shape of readRegistry(). */
function readDatabaseRegistry(dbUrl) {
  const sql = `select coalesce(json_agg(json_build_object('kind', kind, 'category', category,
      'default_enabled', default_enabled, 'bypass_preferences', bypass_preferences,
      'bypass_quiet_hours', bypass_quiet_hours, 'sends_push', sends_push,
      'group_window', extract(epoch from group_window)::int, 'title_key', title_key,
      'body_key', body_key) order by kind), '[]') from kc_private.notification_kinds`;
  return JSON.parse(execFileSync('psql', [dbUrl, '-AtXq', '-c', sql], { encoding: 'utf8' }));
}

function compareWithDatabase(rows, dbUrl) {
  const canonical = (list) => JSON.stringify(list.map((r) => Object.fromEntries(Object.entries(r).sort()))
    .sort((a, b) => (a.kind < b.kind ? -1 : 1)));
  if (canonical(rows) !== canonical(readDatabaseRegistry(dbUrl))) {
    throw new Error('the kinds parsed from the SQL source differ from the registry of the database');
  }
}

function main(argv) {
  const check = argv.includes('--check');
  const dbUrl = argv.includes('--db-url') ? argv[argv.indexOf('--db-url') + 1] : null;
  const rows = readRegistry();
  const { kinds, files } = build(rows, parseLocaleModule(readFileSync(join(ROOT, PATHS.locale), 'utf8')));
  if (dbUrl) compareWithDatabase(rows, dbUrl);
  const stale = Object.entries(files).filter(([path, content]) => {
    const file = join(ROOT, path);
    return !existsSync(file) || readFileSync(file, 'utf8') !== content;
  });
  if (check && stale.length > 0) {
    console.error(`generate-notification-kinds: stale — run \`node scripts/generate-notification-kinds.mjs\`:\n  ${stale.map(([p]) => p).join('\n  ')}`);
    process.exit(1);
  }
  if (!check) for (const [path, content] of stale) writeFileSync(join(ROOT, path), content);
  console.log(`generate-notification-kinds: ${kinds.length} kinds, ${check ? 'up to date' : `${stale.length} file(s) written`}` +
    (dbUrl ? ', database registry matches' : ''));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`generate-notification-kinds: ${error.message}`);
    process.exit(1);
  }
}
