/**
 * What the engine must know about the `public` schema to plan a request:
 * which relations exist, how each function is called and what it returns,
 * and which foreign keys link relations (for embedded resources).
 * PostgREST keeps the same cache; it is loaded once and reloaded on a miss.
 */

/** One overload of a function, as far as calling it by argument name goes. */
export interface FunctionSignature {
  readonly args: ReadonlyArray<{ readonly name: string; readonly type: string; readonly hasDefault: boolean }>;
  /** `void`: no result. `scalar`: one value. `row`: a composite (object). */
  readonly returns: 'void' | 'scalar' | 'row';
  readonly returnsSet: boolean;
}

/** A foreign key from `child` to `parent`, both in `public`. */
export interface ForeignKey {
  readonly child: string;
  readonly childColumns: readonly string[];
  readonly parent: string;
  readonly parentColumns: readonly string[];
  /** The child columns are unique, so the parent sees at most one child (one-to-one). */
  readonly childUnique: boolean;
}

export interface SchemaCache {
  readonly relations: ReadonlySet<string>;
  readonly functions: ReadonlyMap<string, readonly FunctionSignature[]>;
  readonly foreignKeys: readonly ForeignKey[];
}

/** Runs a catalog query; the engine passes the pool's `query`. */
export type CatalogQuery = <Row>(text: string) => Promise<{ rows: Row[] }>;

const RELATIONS_SQL = `
  select c.relname as name
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')`;

// Argument modes: i = in, b = inout, v = variadic are inputs; o / t are outputs.
// Defaults always belong to the last `pronargdefaults` input arguments.
const FUNCTIONS_SQL = `
  select p.proname as name,
         coalesce(p.proargnames, '{}') as arg_names,
         coalesce(p.proargmodes::text[], '{}') as arg_modes,
         coalesce((select array_agg(pg_catalog.format_type(a.type_oid, null) order by a.position)
                   from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality as a(type_oid, position)),
                  '{}') as arg_types,
         p.pronargdefaults::int as default_count,
         p.proretset as returns_set,
         rt.typname as return_type,
         rt.typtype as return_kind
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_type rt on rt.oid = p.prorettype
  where n.nspname = 'public' and p.prokind = 'f'`;

// `attname` is of type `name`; the driver only parses `text[]` into an array, hence the casts.
const FOREIGN_KEYS_SQL = `
  select child.relname as child,
         parent.relname as parent,
         (select array_agg(a.attname::text order by k.position)
          from unnest(con.conkey) with ordinality as k(attnum, position)
          join pg_catalog.pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as child_columns,
         (select array_agg(a.attname::text order by k.position)
          from unnest(con.confkey) with ordinality as k(attnum, position)
          join pg_catalog.pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as parent_columns,
         exists (select 1 from pg_catalog.pg_index i
                 where i.indrelid = con.conrelid and i.indisunique and i.indpred is null
                   and (select array_agg(x order by x) from unnest(i.indkey::int2[]) as x)
                     = (select array_agg(x order by x) from unnest(con.conkey) as x)) as child_unique
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class child on child.oid = con.conrelid
  join pg_catalog.pg_namespace child_ns on child_ns.oid = child.relnamespace
  join pg_catalog.pg_class parent on parent.oid = con.confrelid
  join pg_catalog.pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
  where con.contype = 'f' and child_ns.nspname = 'public' and parent_ns.nspname = 'public'`;

interface FunctionRow {
  name: string;
  arg_names: string[];
  arg_modes: string[];
  arg_types: string[];
  default_count: number;
  returns_set: boolean;
  return_type: string;
  return_kind: string;
}

interface ForeignKeyRow {
  child: string;
  parent: string;
  child_columns: string[];
  parent_columns: string[];
  child_unique: boolean;
}

const INPUT_MODES = new Set(['i', 'b', 'v']);

function returnShape(row: FunctionRow): FunctionSignature['returns'] {
  if (row.return_type === 'void') return 'void';
  // A composite type, or `record` (OUT parameters / RETURNS TABLE), is a row.
  return row.return_kind === 'c' || row.return_type === 'record' ? 'row' : 'scalar';
}

/** Exported for tests: turns one catalog row into a signature. */
export function toFunctionSignature(row: FunctionRow): FunctionSignature {
  const inputs = row.arg_types
    .map((type, index) => ({ name: row.arg_names[index] ?? '', type, mode: row.arg_modes[index] ?? 'i' }))
    .filter((arg) => INPUT_MODES.has(arg.mode));
  const firstDefault = inputs.length - row.default_count;
  return {
    args: inputs.map((arg, index) => ({ name: arg.name, type: arg.type, hasDefault: index >= firstDefault })),
    returns: returnShape(row),
    returnsSet: row.returns_set,
  };
}

/** Reads the three catalog views and assembles the cache. */
export async function loadSchemaCache(query: CatalogQuery): Promise<SchemaCache> {
  const [relations, functions, foreignKeys] = await Promise.all([
    query<{ name: string }>(RELATIONS_SQL),
    query<FunctionRow>(FUNCTIONS_SQL),
    query<ForeignKeyRow>(FOREIGN_KEYS_SQL),
  ]);

  const byName = new Map<string, FunctionSignature[]>();
  for (const row of functions.rows) {
    const overloads = byName.get(row.name) ?? [];
    overloads.push(toFunctionSignature(row));
    byName.set(row.name, overloads);
  }

  return {
    relations: new Set(relations.rows.map((row) => row.name)),
    functions: byName,
    foreignKeys: foreignKeys.rows.map((row) => ({
      child: row.child,
      childColumns: row.child_columns,
      parent: row.parent,
      parentColumns: row.parent_columns,
      childUnique: row.child_unique,
    })),
  };
}
