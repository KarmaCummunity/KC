/**
 * Reads the FSM catalog rows that the production baseline (`supabase/schemas/**`) seeds into
 * `kc_private.fsm_state` and `kc_private.fsm_edge`, without a database.
 *
 * The contract test (`catalogMatchesSql.test.ts`) compares the result with the domain
 * registry `FSM_MACHINES`, so a schema file that drifts from the TypeScript graph fails CI.
 *
 * Understood statement shapes (both appear in the baseline):
 *   insert into kc_private.fsm_state (machine_id, status) values ('m', 's'), ...;
 *   insert into kc_private.fsm_edge (machine_id, from_status, to_status[, role]) values ('m', 'f', 't'[, 'r']), ...;
 *   ... the same two inserts written as `select ... from (values (...)) ...` where a cell may
 *   be `array['a', 'b']` (a state list, or a role list that expands to one edge row per role).
 * An edge without a role column or with `''` is unrestricted (`role = ''`). Any other
 * statement that changes a catalog table throws, so a write this reader cannot understand
 * is never silently ignored.
 */
import { ValidationError } from '@kc/domain';

export type FsmStateRow = { readonly machineId: string; readonly status: string };
export type FsmEdgeRow = {
  readonly machineId: string;
  readonly from: string;
  readonly to: string;
  readonly role: string;
};
export type FsmCatalogSnapshot = { readonly states: FsmStateRow[]; readonly edges: FsmEdgeRow[] };
export type SchemaFile = { readonly name: string; readonly sql: string };

/** A single-quoted SQL literal, with `''` as the escaped quote. */
const LITERAL = "'(?:''|[^'])*'";
/** A cell: a literal, or `array['a', 'b']`. */
const CELL = `(?:${LITERAL}|array\\[\\s*${LITERAL}(?:\\s*,\\s*${LITERAL})*\\s*\\])`;
const TUPLE = new RegExp(`\\(\\s*${CELL}(?:\\s*,\\s*${CELL})*\\s*\\)`, 'gi');

const INSERT = /^insert\s+into\s+kc_private\.fsm_(state|edge)\s*\(([^)]*)\)\s*(values|select)\b([\s\S]*)$/i;
const STATE_COLUMNS = ['machine_id', 'status'];
const EDGE_COLUMNS = ['machine_id', 'from_status', 'to_status'];

/** Any reference to a catalog table: bare, schema-qualified, or double-quoted. */
const CATALOG_NAME = /(?:^|[^a-z0-9_$])(?:"?[a-z_][a-z0-9_]*"?\s*\.\s*)?"?fsm_(?:state|edge)"?(?![a-z0-9_$"])/i;
/** Leading keywords of statements that can change rows (`do` runs an anonymous block). */
const DATA_CHANGING = new Set(['insert', 'delete', 'update', 'truncate', 'copy', 'merge', 'with', 'do']);

/**
 * Returns the index just past the single-quoted literal that starts at `start`.
 * An unterminated literal runs to the end of the input.
 */
function endOfLiteral(sql: string, start: number): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
    if (sql[i] === "'") return i + 1;
    i += 1;
  }
  return sql.length;
}

/** Removes `--` line comments and `/* *\/` block comments, leaving string literals intact. */
function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      const end = endOfLiteral(sql, i);
      out += sql.slice(i, end);
      i = end;
    } else if (sql.startsWith('--', i)) {
      const newline = sql.indexOf('\n', i);
      i = newline === -1 ? sql.length : newline + 1;
      out += '\n';
    } else if (sql.startsWith('/*', i)) {
      const close = sql.indexOf('*/', i + 2);
      i = close === -1 ? sql.length : close + 2;
      out += ' ';
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

/** Returns the dollar-quote tag (`$$` or `$tag$`) that opens at `index`, or null. */
function dollarTagAt(sql: string, index: number): string | null {
  if (sql[index] !== '$' || /[a-z0-9_$]/i.test(sql[index - 1] ?? '')) return null;
  return /^\$(?:[a-z_][a-z0-9_]*)?\$/i.exec(sql.slice(index, index + 64))?.[0] ?? null;
}

/**
 * Splits a comment-free script on top-level `;`. Semicolons inside string literals and
 * dollar-quoted bodies (functions, `do` blocks) do not split, so a function body stays
 * part of its `create function` statement and is never read as catalog data.
 */
function splitStatements(sql: string): string[] {
  const parts: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const tag = sql[i] === "'" ? null : dollarTagAt(sql, i);
    let end = i + 1;
    if (sql[i] === "'") {
      end = endOfLiteral(sql, i);
    } else if (tag) {
      const close = sql.indexOf(tag, i + tag.length);
      end = close === -1 ? sql.length : close + tag.length;
    } else if (sql[i] === ';') {
      parts.push(current);
      current = '';
      i += 1;
      continue;
    }
    current += sql.slice(i, end);
    i = end;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function unquote(raw: string): string {
  return raw.replace(/''/g, "'");
}

/** A tuple cell as the values it stands for: one for a literal, many for an array. */
function expandCell(raw: string): string[] {
  return [...raw.matchAll(new RegExp(LITERAL, 'g'))].map((m) => unquote(m[0].slice(1, -1)));
}

/** Splits a tuple's text into its cells (a literal or an `array[...]`). */
function cellsOf(tuple: string): string[][] {
  const inner = tuple.slice(1, -1);
  return [...inner.matchAll(new RegExp(CELL, 'gi'))].map((m) => expandCell(m[0]));
}

function single(cell: readonly string[] | undefined, what: string): string {
  const value = cell?.[0];
  if (value === undefined || (cell?.length ?? 0) !== 1) {
    throw new ValidationError(`${what} must be a single literal`, 'sql');
  }
  return value;
}

function columnsOf(list: string): string[] {
  return list.split(',').map((column) => column.trim().toLowerCase());
}

function applyInsert(match: RegExpExecArray, states: FsmStateRow[], edges: FsmEdgeRow[]): void {
  const kind = (match[1] ?? '').toLowerCase();
  const columns = columnsOf(match[2] ?? '');
  const tuples = [...(match[4] ?? '').matchAll(TUPLE)].map((m) => cellsOf(m[0]));
  if (tuples.length === 0) throw new ValidationError('catalog insert has no literal tuples', 'sql');
  if (kind === 'state') {
    if (columns.join() !== STATE_COLUMNS.join()) throw new ValidationError('fsm_state columns', 'sql');
    for (const cells of tuples) {
      if (cells.length !== 2) throw new ValidationError(`fsm_state tuple width ${cells.length}`, 'sql');
      for (const status of cells[1] ?? []) states.push({ machineId: single(cells[0], 'machine_id'), status });
    }
    return;
  }
  const withRole = columns.join() === [...EDGE_COLUMNS, 'role'].join();
  if (!withRole && columns.join() !== EDGE_COLUMNS.join()) throw new ValidationError('fsm_edge columns', 'sql');
  for (const cells of tuples) {
    if (cells.length !== (withRole ? 4 : 3)) {
      throw new ValidationError(`fsm_edge tuple width ${cells.length}`, 'sql');
    }
    for (const role of withRole ? (cells[3] ?? []) : ['']) {
      edges.push({
        machineId: single(cells[0], 'machine_id'),
        from: single(cells[1], 'from_status'),
        to: single(cells[2], 'to_status'),
        role,
      });
    }
  }
}

/** True when a data-changing statement mentions a catalog table outside a string literal. */
function namesCatalog(keyword: string, statement: string): boolean {
  const scanned = keyword === 'do' ? statement : statement.replace(new RegExp(LITERAL, 'g'), "''");
  return CATALOG_NAME.test(scanned);
}

/**
 * Reads the catalog seeds of `files` in path order (the order they are assembled into
 * `supabase/migrations/0001_baseline.sql`) and returns the resulting rows.
 */
export function readBaselineFsmSeeds(files: readonly SchemaFile[]): FsmCatalogSnapshot {
  const states: FsmStateRow[] = [];
  const edges: FsmEdgeRow[] = [];
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name));
  for (const file of ordered) {
    for (const raw of splitStatements(stripComments(file.sql))) {
      const statement = raw.trim();
      const keyword = /^([a-z]+)/i.exec(statement)?.[1]?.toLowerCase() ?? '';
      if (!DATA_CHANGING.has(keyword) || !namesCatalog(keyword, statement)) continue;
      const insert = INSERT.exec(statement);
      if (!insert) {
        throw new ValidationError(`unrecognised fsm catalog statement: ${statement.slice(0, 80)}`, 'sql');
      }
      applyInsert(insert, states, edges);
    }
  }
  return { states, edges };
}
