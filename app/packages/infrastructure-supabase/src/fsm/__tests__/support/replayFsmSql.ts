/**
 * Replays the FSM catalog rows that `supabase/migrations` write into `public.fsm_state`
 * and `public.fsm_edge`, without a database.
 *
 * The contract test (`catalogMatchesSql.test.ts`) compares the result with the domain
 * registry `FSM_MACHINES`, so a migration that drifts from the TypeScript graph fails CI.
 *
 * Only four statement shapes are understood (design spec §4.2,
 * `docs/superpowers/specs/2026-11-09-fsm-kernel-design.md`):
 *   insert into public.fsm_state (machine_id, status) values ('id', 'status'), …;
 *   insert into public.fsm_edge (machine_id, from_status, to_status, role) values ('id', 'from', 'to', 'role'), …;
 *   delete from public.fsm_state where machine_id = 'id';
 *   delete from public.fsm_edge where machine_id = 'id';
 * Any other data-changing statement that names a catalog table throws, so a write the
 * replay cannot read is never silently ignored.
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
export type MigrationFile = { readonly name: string; readonly sql: string };

/** A single-quoted SQL literal, with `''` as the escaped quote. */
const LITERAL = "'(?:''|[^'])*'";
/** A parenthesised list of literals: `('a', 'b')`. */
const TUPLE = `\\(\\s*${LITERAL}(?:\\s*,\\s*${LITERAL})*\\s*\\)`;
/** A `values` body made only of literal tuples — no `default`, `null`, numbers or trailing clauses. */
const VALUES_BODY = new RegExp(`^\\s*${TUPLE}(?:\\s*,\\s*${TUPLE})*\\s*$`);

const STATE_INSERT = /^insert\s+into\s+public\.fsm_state\s*\(\s*machine_id\s*,\s*status\s*\)\s*values\b([\s\S]*)$/i;
const EDGE_INSERT = /^insert\s+into\s+public\.fsm_edge\s*\(\s*machine_id\s*,\s*from_status\s*,\s*to_status\s*,\s*role\s*\)\s*values\b([\s\S]*)$/i;
const STATE_DELETE = /^delete\s+from\s+public\.fsm_state\s+where\s+machine_id\s*=\s*'((?:''|[^'])*)'\s*$/i;
const EDGE_DELETE = /^delete\s+from\s+public\.fsm_edge\s+where\s+machine_id\s*=\s*'((?:''|[^'])*)'\s*$/i;

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

/** Parses a `values` body into rows of exactly `width` unquoted cells. */
function parseTuples(body: string, width: number): string[][] {
  if (!VALUES_BODY.test(body)) {
    throw new ValidationError('catalog insert values must be quoted literal tuples only', 'sql');
  }
  const rows: string[][] = [];
  for (const tuple of body.matchAll(new RegExp(TUPLE, 'g'))) {
    const cells = [...tuple[0].matchAll(new RegExp(LITERAL, 'g'))].map((match) =>
      unquote(match[0].slice(1, -1)),
    );
    if (cells.length !== width) throw new ValidationError(`catalog tuple width ${cells.length}`, 'sql');
    rows.push(cells);
  }
  return rows;
}

/** Reads a capture group that the regex guarantees; throws instead of returning undefined. */
function group(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new ValidationError(`missing sql group ${index}`, 'sql');
  return value;
}

/** Reads a cell that `parseTuples` guarantees by width; satisfies `noUncheckedIndexedAccess`. */
function cell(row: readonly string[], index: number): string {
  const value = row[index];
  if (value === undefined) throw new ValidationError(`missing catalog cell ${index}`, 'sql');
  return value;
}

/**
 * True when a data-changing statement mentions a catalog table outside a string literal.
 * A `do` block is scanned with its literals intact, because its body is dollar-quoted.
 */
function namesCatalog(keyword: string, statement: string): boolean {
  const scanned = keyword === 'do' ? statement : statement.replace(new RegExp(LITERAL, 'g'), "''");
  return CATALOG_NAME.test(scanned);
}

function removeMachine<T extends { readonly machineId: string }>(rows: T[], machineId: string): void {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]?.machineId === machineId) rows.splice(index, 1);
  }
}

/** Applies one catalog statement to the snapshot; throws when it is not one of the four shapes. */
function applyStatement(statement: string, states: FsmStateRow[], edges: FsmEdgeRow[]): void {
  const stateInsert = STATE_INSERT.exec(statement);
  if (stateInsert) {
    for (const row of parseTuples(group(stateInsert, 1), 2)) {
      states.push({ machineId: cell(row, 0), status: cell(row, 1) });
    }
    return;
  }
  const edgeInsert = EDGE_INSERT.exec(statement);
  if (edgeInsert) {
    for (const row of parseTuples(group(edgeInsert, 1), 4)) {
      edges.push({ machineId: cell(row, 0), from: cell(row, 1), to: cell(row, 2), role: cell(row, 3) });
    }
    return;
  }
  const stateDelete = STATE_DELETE.exec(statement);
  if (stateDelete) {
    removeMachine(states, unquote(group(stateDelete, 1)));
    return;
  }
  const edgeDelete = EDGE_DELETE.exec(statement);
  if (edgeDelete) {
    removeMachine(edges, unquote(group(edgeDelete, 1)));
    return;
  }
  throw new ValidationError(`unrecognised fsm catalog statement: ${statement.slice(0, 80)}`, 'sql');
}

/**
 * Replays the catalog writes of `files` in filename order (the order `supabase db push`
 * applies them) and returns the resulting `fsm_state` / `fsm_edge` rows.
 */
export function replayFsmSql(files: readonly MigrationFile[]): FsmCatalogSnapshot {
  const states: FsmStateRow[] = [];
  const edges: FsmEdgeRow[] = [];
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name));
  for (const file of ordered) {
    for (const raw of splitStatements(stripComments(file.sql))) {
      const statement = raw.trim();
      const keyword = /^([a-z]+)/i.exec(statement)?.[1]?.toLowerCase() ?? '';
      if (!DATA_CHANGING.has(keyword) || !namesCatalog(keyword, statement)) continue;
      applyStatement(statement, states, edges);
    }
  }
  return { states, edges };
}
