import { PostgrestCompatError, quoteIdentifier } from './compatError';
import type { Plan, RowShape } from './requestPlan';
import type { FunctionSignature, SchemaCache } from './schemaCache';
import type { SelectItem } from './selectGrammar';
import { filterConditions, orderSql, projectionSql, relationSql, whereSql } from './sqlRows';
import { SqlParameters, type SqlStatement } from './sqlText';

/**
 * Every statement built here returns exactly one row:
 *   body       JSON text of the result (null when there is none)
 *   row_count  rows in the body
 *   total      matching rows before limit / offset (only when a count was asked for)
 * JSON is produced by Postgres itself, as PostgREST does, so values keep the
 * exact text form the adapters already parse (timestamps, numerics, arrays).
 */
export interface ResultRow {
  body: string | null;
  row_count: number;
  total?: string | null;
}

/** PostgREST's `max-rows` on the Supabase stack (`supabase/config.toml`). */
export const MAX_ROWS = 1000;

const AGGREGATE = `coalesce(json_agg(_rows), '[]')::text as body, count(*)::int as row_count`;
/** For a function that returns one composite value: the object itself, as PostgREST answers it. */
const FIRST_ROW = `(json_agg(_rows) -> 0)::text as body, count(*)::int as row_count`;

function limitSql(shape: RowShape): string {
  const limit = Math.min(shape.limit ?? MAX_ROWS, MAX_ROWS);
  return ` limit ${limit}${shape.offset > 0 ? ` offset ${shape.offset}` : ''}`;
}

/** Reads rows from `from` (a relation or a function call aliased as `source`). */
function rowsStatement(
  from: string,
  source: string,
  sourceRelation: string | null,
  shape: RowShape,
  count: boolean,
  cache: SchemaCache,
  parameters: SqlParameters,
  prelude = '',
  aggregate = AGGREGATE,
): SqlStatement {
  const conditions = filterConditions(shape.filters, source, parameters);
  const columns = projectionSql(shape.select, source, sourceRelation, cache, conditions);
  const where = whereSql(conditions);
  const total = count ? `, (select count(*) from ${from}${where})::text as total` : '';
  const rows = `select ${columns} from ${from}${where}${orderSql(shape.order, source)}${limitSql(shape)}`;
  const lead = prelude ? `${prelude}, ` : 'with ';
  return { text: `${lead}_rows as (${rows}) select ${aggregate}${total} from _rows`, values: parameters.values };
}

/** Wraps a data-changing statement and shapes what it returned. */
function changeStatement(
  change: string,
  table: string,
  returning: SelectItem[] | null,
  cache: SchemaCache,
  parameters: SqlParameters,
): SqlStatement {
  if (!returning) {
    // `returning 1` names no column, so it asks for no right to read the rows: it only lets them be counted, as PostgREST does.
    return { text: `with _changed as (${change} returning 1) select null::text as body, (select count(*) from _changed)::int as row_count`, values: parameters.values };
  }
  const columns = projectionSql(returning, '_changed', null, cache, []);
  // `table.*`, not `*`: an UPDATE also has its patch source in scope.
  return {
    text: `with _changed as (${change} returning ${table}.*), _rows as (select ${columns} from _changed) select ${AGGREGATE} from _rows`,
    values: parameters.values,
  };
}

/** Postgres refuses a whole-table UPDATE / DELETE on Supabase (`safeupdate`); so does the engine. */
function requireFilters(verb: 'UPDATE' | 'DELETE', filterCount: number): void {
  if (filterCount === 0) throw new PostgrestCompatError('21000', 400, `${verb} requires a WHERE clause`);
}

function insertStatement(plan: Extract<Plan, { kind: 'insert' }>, cache: SchemaCache): SqlStatement {
  const parameters = new SqlParameters();
  const table = relationSql(plan.relation);
  if (plan.columns.length === 0) {
    return changeStatement(`insert into ${table} default values`, table, plan.returning, cache, parameters);
  }
  const columns = plan.columns.map(quoteIdentifier);
  const list = columns.join(', ');
  // The JSON body is converted by the table's own column types, like PostgREST.
  const source = `select ${list} from json_populate_recordset(null::${table}, ${parameters.add(JSON.stringify(plan.rows))}::json)`;
  let conflict = '';
  if (plan.conflict) {
    const target = plan.conflict.target.map(quoteIdentifier).join(', ');
    const assignments = columns.map((column) => `${column} = excluded.${column}`).join(', ');
    conflict = plan.conflict.resolution === 'merge' ? ` on conflict (${target}) do update set ${assignments}` : ` on conflict (${target}) do nothing`;
  }
  return changeStatement(`insert into ${table} (${list}) ${source}${conflict}`, table, plan.returning, cache, parameters);
}

function updateStatement(plan: Extract<Plan, { kind: 'update' }>, cache: SchemaCache): SqlStatement {
  requireFilters('UPDATE', plan.filters.length);
  const parameters = new SqlParameters();
  const table = relationSql(plan.relation);
  const columns = Object.keys(plan.patch).map(quoteIdentifier);
  if (columns.length === 0) throw new PostgrestCompatError('PGRST100', 400, 'an update needs at least one column');
  const assignments = columns.map((column) => `${column} = _patch.${column}`).join(', ');
  const patch = `(select * from json_populate_record(null::${table}, ${parameters.add(JSON.stringify(plan.patch))}::json)) as _patch`;
  const where = whereSql(filterConditions(plan.filters, table, parameters));
  return changeStatement(`update ${table} set ${assignments} from ${patch}${where}`, table, plan.returning, cache, parameters);
}

function deleteStatement(plan: Extract<Plan, { kind: 'delete' }>, cache: SchemaCache): SqlStatement {
  requireFilters('DELETE', plan.filters.length);
  const parameters = new SqlParameters();
  const table = relationSql(plan.relation);
  const where = whereSql(filterConditions(plan.filters, table, parameters));
  return changeStatement(`delete from ${table}${where}`, table, plan.returning, cache, parameters);
}

/** Picks the overload a call by these argument names means. */
export function resolveSignature(name: string, provided: readonly string[], cache: SchemaCache): FunctionSignature {
  const matches = (cache.functions.get(name) ?? []).filter((signature) => {
    const names = new Set(signature.args.map((arg) => arg.name));
    const required = signature.args.filter((arg) => !arg.hasDefault);
    return provided.every((key) => names.has(key)) && required.every((arg) => provided.includes(arg.name));
  });
  const [signature, ambiguous] = matches;
  if (!signature) {
    const shown = [...provided].sort().join(', ');
    const searchedWith = provided.length === 0 ? 'without parameters' : `with parameters ${shown}`;
    throw new PostgrestCompatError(
      'PGRST202',
      404,
      `Could not find the function public.${name}${provided.length === 0 ? ' without parameters' : `(${shown})`} in the schema cache`,
      `Searched for the function public.${name} ${searchedWith} or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.`,
    );
  }
  if (ambiguous) {
    throw new PostgrestCompatError('PGRST203', 300, `Could not choose the best candidate function for public.${name}`);
  }
  return signature;
}

function rpcStatement(plan: Extract<Plan, { kind: 'rpc' }>, cache: SchemaCache): SqlStatement {
  const provided = Object.keys(plan.args);
  const signature = resolveSignature(plan.name, provided, cache);
  const parameters = new SqlParameters();
  const fn = relationSql(plan.name);

  // Arguments arrive as one JSON object; `json_to_record` converts each to
  // the type the function declares (uuid, arrays, jsonb, enums …).
  let prelude = '';
  let call = `${fn}()`;
  if (provided.length > 0) {
    const typed = signature.args
      .filter((arg) => provided.includes(arg.name))
      .map((arg) => `${quoteIdentifier(arg.name)} ${arg.type}`);
    prelude = `with _args as (select * from json_to_record(${parameters.add(JSON.stringify(plan.args))}::json) as _typed(${typed.join(', ')}))`;
    const named = provided.map((key) => `${quoteIdentifier(key)} => (select ${quoteIdentifier(key)} from _args)`);
    call = `${fn}(${named.join(', ')})`;
  }
  const lead = prelude ? `${prelude} ` : '';

  if (signature.returns === 'void') {
    return { text: `${lead}select null::text as body, 0 as row_count from (select ${call}) as _call`, values: parameters.values };
  }
  if (signature.returns === 'scalar' && !signature.returnsSet) {
    return { text: `${lead}select to_json(${call})::text as body, 1 as row_count`, values: parameters.values };
  }
  if (signature.returns === 'scalar') {
    return {
      text: `${lead}select coalesce(json_agg(_value), '[]')::text as body, count(*)::int as row_count from ${call} as _value`,
      values: parameters.values,
    };
  }
  // The call is materialised once: counting or filtering its rows must never run it again.
  const result = `_result as materialized (select * from ${call})`;
  const before = prelude ? `${prelude}, ${result}` : `with ${result}`;
  return rowsStatement('_result', '_result', null, plan, plan.count, cache, parameters, before, signature.returnsSet ? AGGREGATE : FIRST_ROW);
}

/** Builds the one statement that answers `plan`. */
export function buildStatement(plan: Plan, cache: SchemaCache): SqlStatement {
  switch (plan.kind) {
    case 'read':
      return rowsStatement(relationSql(plan.relation), relationSql(plan.relation), plan.relation, plan, plan.count, cache, new SqlParameters());
    case 'insert':
      return insertStatement(plan, cache);
    case 'update':
      return updateStatement(plan, cache);
    case 'delete':
      return deleteStatement(plan, cache);
    case 'rpc':
      return rpcStatement(plan, cache);
  }
}
