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

function tuples(body: string, width: number): string[][] {
  const rows: string[][] = [];
  const re = /\(\s*((?:'(?:''|[^'])*'\s*,\s*)*(?:'(?:''|[^'])*'))\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    const cells = [...match[1].matchAll(/'((?:''|[^'])*)'/g)].map((cell) => unquote(cell[1]));
    if (cells.length !== width) throw new ValidationError(`catalog tuple width ${cells.length}`, 'sql');
    rows.push(cells);
  }
  if (rows.length === 0) throw new ValidationError('catalog insert has no tuples', 'sql');
  return rows;
}

const STATE_INSERT = /^insert\s+into\s+public\.fsm_state\s*\(\s*machine_id\s*,\s*status\s*\)\s*values\b([\s\S]*)$/i;
const EDGE_INSERT = /^insert\s+into\s+public\.fsm_edge\s*\(\s*machine_id\s*,\s*from_status\s*,\s*to_status\s*,\s*role\s*\)\s*values\b([\s\S]*)$/i;
const STATE_DELETE = /^delete\s+from\s+public\.fsm_state\s+where\s+machine_id\s*=\s*'((?:''|[^'])*)'\s*$/i;
const EDGE_DELETE = /^delete\s+from\s+public\.fsm_edge\s+where\s+machine_id\s*=\s*'((?:''|[^'])*)'\s*$/i;

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
      const catalog = /public\.fsm_(state|edge)\b/i.test(trimmed);
      if (!catalog || (keyword !== 'insert' && keyword !== 'delete' && keyword !== 'update')) continue;
      const stateInsert = STATE_INSERT.exec(trimmed);
      if (stateInsert) {
        for (const [machineId, status] of tuples(stateInsert[1], 2)) states.push({ machineId, status });
        continue;
      }
      const edgeInsert = EDGE_INSERT.exec(trimmed);
      if (edgeInsert) {
        for (const [machineId, from, to, role] of tuples(edgeInsert[1], 4)) {
          edges.push({ machineId, from, to, role });
        }
        continue;
      }
      const stateDelete = STATE_DELETE.exec(trimmed);
      if (stateDelete) {
        const id = unquote(stateDelete[1]);
        for (let index = states.length - 1; index >= 0; index -= 1) {
          if (states[index].machineId === id) states.splice(index, 1);
        }
        continue;
      }
      const edgeDelete = EDGE_DELETE.exec(trimmed);
      if (edgeDelete) {
        const id = unquote(edgeDelete[1]);
        for (let index = edges.length - 1; index >= 0; index -= 1) {
          if (edges[index].machineId === id) edges.splice(index, 1);
        }
        continue;
      }
      throw new ValidationError(`unrecognised fsm catalog statement: ${trimmed.slice(0, 80)}`, 'sql');
    }
  }
  return { states, edges };
}
