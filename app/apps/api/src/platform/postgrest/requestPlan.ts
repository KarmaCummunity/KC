import { badRequest, unsupported } from './compatError';
import { type Filter, parseCondition, parseGroup } from './filterGrammar';
import { parseSelect, type SelectItem } from './selectGrammar';

/** The parts of an HTTP request the engine reads. */
export interface CompatRequest {
  readonly method: string;
  readonly url: string;
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
}

export interface OrderTerm {
  readonly column: string;
  readonly descending: boolean;
  readonly nulls: 'first' | 'last' | null;
}

/** Row shaping shared by table reads and row-returning functions. */
export interface RowShape {
  readonly select: SelectItem[];
  readonly filters: Filter[];
  readonly order: OrderTerm[];
  readonly limit: number | null;
  readonly offset: number;
}

interface ResponseShape {
  /** `Prefer: count=exact`: report the total number of matching rows. */
  readonly count: boolean;
  /** `HEAD`: headers only. */
  readonly head: boolean;
  /** `Accept: application/vnd.pgrst.object+json`: exactly one row, as an object. */
  readonly singular: boolean;
}

export type Plan =
  | ({ kind: 'read'; relation: string } & RowShape & ResponseShape)
  | ({ kind: 'rpc'; name: string; args: Readonly<Record<string, unknown>> } & RowShape & ResponseShape)
  | {
      kind: 'insert';
      relation: string;
      rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
      columns: string[];
      conflict: { target: string[]; resolution: 'merge' | 'ignore' } | null;
      returning: SelectItem[] | null;
      singular: boolean;
    }
  | {
      kind: 'update';
      relation: string;
      patch: Readonly<Record<string, unknown>>;
      filters: Filter[];
      returning: SelectItem[] | null;
      singular: boolean;
    }
  | { kind: 'delete'; relation: string; filters: Filter[]; returning: SelectItem[] | null; singular: boolean };

/** Query parameters that shape the result instead of filtering a column. */
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
const PATH = /\/(rpc\/)?([A-Za-z_][A-Za-z0-9_]*)\/?$/;

function parseOrder(raw: string | null): OrderTerm[] {
  if (!raw) return [];
  return raw.split(',').map((term) => {
    const [column = '', ...modifiers] = term.split('.');
    if (column.includes('(')) throw unsupported('ordering by an embedded resource');
    const nulls = modifiers.includes('nullsfirst') ? 'first' : modifiers.includes('nullslast') ? 'last' : null;
    return { column, descending: modifiers.includes('desc'), nulls };
  });
}

function parseCount(name: string, raw: string | null): number | null {
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) throw badRequest(`"${name}" must be a non-negative integer`);
  return Number(raw);
}

function parseFilters(query: URLSearchParams): Filter[] {
  const filters: Filter[] = [];
  for (const [key, value] of query) {
    if (RESERVED.has(key)) continue;
    if (key === 'or' || key === 'and') filters.push(parseGroup(key, value));
    else if (key === 'not.or' || key === 'not.and') filters.push(parseGroup(key.slice(4) as 'and' | 'or', value, true));
    else filters.push(parseCondition(key, value, false));
  }
  return filters;
}

function rowShape(query: URLSearchParams): RowShape {
  return {
    select: parseSelect(query.get('select')),
    filters: parseFilters(query),
    order: parseOrder(query.get('order')),
    limit: parseCount('limit', query.get('limit')),
    offset: parseCount('offset', query.get('offset')) ?? 0,
  };
}

/** `"a","b"` or `a,b` → `['a', 'b']`. */
function parseNames(raw: string | null): string[] | null {
  if (!raw) return null;
  return raw.split(',').map((name) => name.replace(/^"|"$/g, ''));
}

function parseBody(body: string | null): unknown {
  if (body === null || body === '') return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new SyntaxError('request body is not JSON');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function insertPlan(relation: string, query: URLSearchParams, body: unknown, prefer: string, singular: boolean): Plan {
  const rows = Array.isArray(body) ? body : [body];
  if (!rows.every(isRecord)) throw badRequest('an insert body must be an object or an array of objects');
  const target = parseNames(query.get('on_conflict'));
  const merges = prefer.includes('resolution=merge-duplicates');
  const ignores = prefer.includes('resolution=ignore-duplicates');
  if ((merges || ignores) && !target) throw unsupported('upsert without an explicit on_conflict target');
  return {
    kind: 'insert',
    relation,
    rows,
    columns: parseNames(query.get('columns')) ?? Object.keys(rows[0] ?? {}),
    conflict: target && (merges || ignores) ? { target, resolution: merges ? 'merge' : 'ignore' } : null,
    returning: prefer.includes('return=representation') ? parseSelect(query.get('select')) : null,
    singular,
  };
}

/** Turns an HTTP request in PostgREST's dialect into what to run. */
export function planRequest(request: CompatRequest): Plan {
  const url = new URL(request.url);
  const path = PATH.exec(url.pathname);
  if (!path) throw badRequest(`unrecognised path: ${url.pathname}`);
  const [, rpcPrefix, name = ''] = path;
  const query = url.searchParams;
  const method = request.method.toUpperCase();
  const prefer = request.headers.prefer ?? '';
  const response: ResponseShape = {
    count: prefer.includes('count=exact'),
    head: method === 'HEAD',
    singular: (request.headers.accept ?? '').includes('application/vnd.pgrst.object+json'),
  };
  if (/count=(planned|estimated)/.test(prefer)) throw unsupported('estimated counts');

  if (rpcPrefix) {
    if (method !== 'POST') throw unsupported('calling a function with GET or HEAD');
    const args = parseBody(request.body);
    if (!isRecord(args)) throw badRequest('function arguments must be a JSON object');
    return { kind: 'rpc', name, args, ...rowShape(query), ...response };
  }

  const returning = prefer.includes('return=representation') ? parseSelect(query.get('select')) : null;
  switch (method) {
    case 'GET':
    case 'HEAD':
      return { kind: 'read', relation: name, ...rowShape(query), ...response };
    case 'POST':
      return insertPlan(name, query, parseBody(request.body), prefer, response.singular);
    case 'PATCH': {
      const patch = parseBody(request.body);
      if (!isRecord(patch)) throw badRequest('an update body must be a JSON object');
      return { kind: 'update', relation: name, patch, filters: parseFilters(query), returning, singular: response.singular };
    }
    case 'DELETE':
      return { kind: 'delete', relation: name, filters: parseFilters(query), returning, singular: response.singular };
    default:
      throw unsupported(`HTTP method ${method}`);
  }
}
