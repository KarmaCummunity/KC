import { ValidationError } from '../errors';

export type FsmStateRow = { readonly machineId: string; readonly status: string };
export type FsmEdgeRow = {
  readonly machineId: string;
  readonly from: string;
  readonly to: string;
  readonly role: string;
};
export type FsmCatalogSnapshot = { readonly states: FsmStateRow[]; readonly edges: FsmEdgeRow[] };

function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      const start = i;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i += 1; break; }
        i += 1;
      }
      out += sql.slice(start, i);
      continue;
    }
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      out += '\n';
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

function dollarTagAt(sql: string, index: number): string | null {
  if (sql[index] !== '$' || /[a-z0-9_$]/i.test(sql[index - 1] ?? '')) return null;
  return /^\$(?:[a-z_][a-z0-9_]*)?\$/i.exec(sql.slice(index, index + 64))?.[0] ?? null;
}

function statements(sql: string): string[] {
  const parts: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      current += sql[i];
      i += 1;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") { current += sql[i + 1]; i += 2; continue; }
        if (sql[i] === "'") { i += 1; break; }
        i += 1;
      }
      continue;
    }
    const tag = dollarTagAt(sql, i);
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (sql[i] === ';') { parts.push(current); current = ''; i += 1; continue; }
    current += sql[i];
    i += 1;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function unquote(raw: string): string {
  return raw.replace(/''/g, "'");
}

const LITERAL = "'(?:''|[^'])*'";
const TUPLE = `\\(\\s*${LITERAL}(?:\\s*,\\s*${LITERAL})*\\s*\\)`;
const VALUES_BODY = new RegExp(`^\\s*${TUPLE}(?:\\s*,\\s*${TUPLE})*\\s*$`);

function tuples(body: string, width: number): string[][] {
  if (!VALUES_BODY.test(body)) {
    throw new ValidationError('catalog insert values must be quoted literal tuples only', 'sql');
  }
  const rows: string[][] = [];
  for (const tuple of body.matchAll(new RegExp(TUPLE, 'g'))) {
    const cells = [...tuple[0].matchAll(new RegExp(LITERAL, 'g'))].map((cell) =>
      unquote(cell[0].slice(1, -1)),
    );
    if (cells.length !== width) throw new ValidationError(`catalog tuple width ${cells.length}`, 'sql');
    rows.push(cells);
  }
  return rows;
}

function group(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new ValidationError(`missing sql group ${index}`, 'sql');
  return value;
}

function cell(row: readonly string[], index: number): string {
  const value = row[index];
  if (value === undefined) throw new ValidationError(`missing catalog cell ${index}`, 'sql');
  return value;
}

const STATE_INSERT = /^insert\s+into\s+public\.fsm_state\s*\(\s*machine_id\s*,\s*status\s*\)\s*values\b([\s\S]*)$/i;
const EDGE_INSERT = /^insert\s+into\s+public\.fsm_edge\s*\(\s*machine_id\s*,\s*from_status\s*,\s*to_status\s*,\s*role\s*\)\s*values\b([\s\S]*)$/i;
const STATE_DELETE = /^delete\s+from\s+public\.fsm_state\s+where\s+machine_id\s*=\s*'((?:''|[^'])*)'\s*$/i;
const EDGE_DELETE = /^delete\s+from\s+public\.fsm_edge\s+where\s+machine_id\s*=\s*'((?:''|[^'])*)'\s*$/i;

const CATALOG_NAME = /(?:^|[^a-z0-9_$])(?:"?[a-z_][a-z0-9_]*"?\s*\.\s*)?"?fsm_(?:state|edge)"?(?![a-z0-9_$"])/i;
const DATA_CHANGING = new Set(['insert', 'delete', 'update', 'truncate', 'copy', 'merge', 'with', 'do']);

function blankLiterals(statement: string): string {
  return statement.replace(new RegExp(LITERAL, 'g'), "''");
}

function namesCatalog(keyword: string, statement: string): boolean {
  const scanned = keyword === 'do' ? statement : blankLiterals(statement);
  return CATALOG_NAME.test(scanned);
}

function removeMachine<T extends { readonly machineId: string }>(rows: T[], machineId: string): void {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]?.machineId === machineId) rows.splice(index, 1);
  }
}

export function replayFsmSql(
  files: readonly { readonly name: string; readonly sql: string }[],
): FsmCatalogSnapshot {
  const states: FsmStateRow[] = [];
  const edges: FsmEdgeRow[] = [];
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name));
  for (const file of ordered) {
    for (const statement of statements(stripComments(file.sql))) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      const keyword = /^\s*([a-z]+)/i.exec(trimmed)?.[1]?.toLowerCase() ?? '';
      if (!DATA_CHANGING.has(keyword) || !namesCatalog(keyword, trimmed)) continue;
      const stateInsert = STATE_INSERT.exec(trimmed);
      if (stateInsert) {
        for (const row of tuples(group(stateInsert, 1), 2)) {
          states.push({ machineId: cell(row, 0), status: cell(row, 1) });
        }
        continue;
      }
      const edgeInsert = EDGE_INSERT.exec(trimmed);
      if (edgeInsert) {
        for (const row of tuples(group(edgeInsert, 1), 4)) {
          edges.push({ machineId: cell(row, 0), from: cell(row, 1), to: cell(row, 2), role: cell(row, 3) });
        }
        continue;
      }
      const stateDelete = STATE_DELETE.exec(trimmed);
      if (stateDelete) {
        removeMachine(states, unquote(group(stateDelete, 1)));
        continue;
      }
      const edgeDelete = EDGE_DELETE.exec(trimmed);
      if (edgeDelete) {
        removeMachine(edges, unquote(group(edgeDelete, 1)));
        continue;
      }
      throw new ValidationError(`unrecognised fsm catalog statement: ${trimmed.slice(0, 80)}`, 'sql');
    }
  }
  return { states, edges };
}
