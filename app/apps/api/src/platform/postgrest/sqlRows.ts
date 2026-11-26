import { PostgrestCompatError, quoteIdentifier, unsupported } from './compatError';
import { type Filter, sqlOperator } from './filterGrammar';
import type { OrderTerm } from './requestPlan';
import type { ForeignKey, SchemaCache } from './schemaCache';
import type { SelectItem } from './selectGrammar';
import type { SqlParameters } from './sqlText';

/** Fully qualified, quoted name of a `public` relation. */
export function relationSql(relation: string): string {
  return `"public".${quoteIdentifier(relation)}`;
}

/** `*` in ILIKE / LIKE patterns is PostgREST's URL-safe spelling of `%`. */
function likePattern(value: string): string {
  return value.replace(/\*/g, '%');
}

function filterSql(filter: Filter, qualifier: string, parameters: SqlParameters): string {
  const not = filter.negated ? 'not ' : '';
  if (filter.kind === 'group') {
    const members = filter.filters.map((member) => filterSql(member, qualifier, parameters));
    return `${not}(${members.join(` ${filter.operator} `)})`;
  }
  const column = `${qualifier}.${quoteIdentifier(filter.column)}`;
  switch (filter.kind) {
    case 'is':
      return `${not}(${column} is ${filter.value})`;
    case 'in':
      // One array parameter: its element type is inferred from the column.
      return `${not}(${column} = any(${parameters.add(filter.values)}))`;
    case 'compare': {
      const pattern = filter.operator === 'like' || filter.operator === 'ilike';
      const value = pattern ? likePattern(filter.value) : filter.value;
      return `${not}(${column} ${sqlOperator(filter.operator)} ${parameters.add(value)})`;
    }
  }
}

/** ` where …`, or an empty string when there is nothing to filter on. */
export function whereSql(conditions: readonly string[]): string {
  return conditions.length === 0 ? '' : ` where ${conditions.join(' and ')}`;
}

export function filterConditions(filters: readonly Filter[], qualifier: string, parameters: SqlParameters): string[] {
  return filters.map((filter) => filterSql(filter, qualifier, parameters));
}

export function orderSql(order: readonly OrderTerm[], qualifier: string): string {
  if (order.length === 0) return '';
  const terms = order.map((term) => {
    const direction = term.descending ? ' desc' : ' asc';
    const nulls = term.nulls ? ` nulls ${term.nulls}` : '';
    return `${qualifier}.${quoteIdentifier(term.column)}${direction}${nulls}`;
  });
  return ` order by ${terms.join(', ')}`;
}

/** How an embedded resource joins the relation it is embedded in. */
interface EmbedJoin {
  readonly condition: string;
  /** One related row at most (an object), or many (an array). */
  readonly single: boolean;
}

function joinOn(fk: ForeignKey, source: string, sourceIsChild: boolean): string {
  const target = relationSql(sourceIsChild ? fk.parent : fk.child);
  const pairs = fk.childColumns.map((childColumn, index) => {
    const parentColumn = fk.parentColumns[index] as string;
    const sourceColumn = sourceIsChild ? childColumn : parentColumn;
    const targetColumn = sourceIsChild ? parentColumn : childColumn;
    return `${target}.${quoteIdentifier(targetColumn)} = ${source}.${quoteIdentifier(sourceColumn)}`;
  });
  return pairs.join(' and ');
}

function embedJoin(sourceRelation: string, source: string, target: string, cache: SchemaCache): EmbedJoin {
  if (sourceRelation === target) throw unsupported('embedding a relation in itself');
  const asChild = cache.foreignKeys.filter((fk) => fk.child === sourceRelation && fk.parent === target);
  const asParent = cache.foreignKeys.filter((fk) => fk.parent === sourceRelation && fk.child === target);
  const total = asChild.length + asParent.length;
  if (total === 0) {
    throw new PostgrestCompatError(
      'PGRST200',
      400,
      `Could not find a relationship between '${sourceRelation}' and '${target}' in the schema cache`,
    );
  }
  if (total > 1) throw unsupported(`more than one relationship between '${sourceRelation}' and '${target}'`);
  const [toParent] = asChild;
  if (toParent) return { condition: joinOn(toParent, source, true), single: true };
  const toChild = asParent[0] as ForeignKey;
  return { condition: joinOn(toChild, source, false), single: toChild.childUnique };
}

/**
 * The columns of a `select=` list. An embedded resource becomes a correlated
 * subquery that returns JSON: an object for a to-one relationship, an array
 * for a to-many one. `!inner` embeds add a condition to `conditions`.
 * @param sourceRelation Name of the relation `source` reads, or null for a
 *   function result, which has no foreign keys to embed through.
 */
export function projectionSql(
  items: readonly SelectItem[],
  source: string,
  sourceRelation: string | null,
  cache: SchemaCache,
  conditions: string[],
): string {
  return items
    .map((item) => {
      if (item.kind === 'all') return `${source}.*`;
      if (item.kind === 'column') return `${source}.${quoteIdentifier(item.column)} as ${quoteIdentifier(item.alias)}`;
      if (sourceRelation === null) throw unsupported('embedding a resource in a function result');

      const join = embedJoin(sourceRelation, source, item.relation, cache);
      const target = relationSql(item.relation);
      const nestedConditions = [join.condition];
      const columns = projectionSql(item.items, target, item.relation, cache, nestedConditions);
      const rows = `select ${columns} from ${target}${whereSql(nestedConditions)}`;
      if (item.inner) conditions.push(`exists (select 1 from ${target} where ${join.condition})`);
      const json = join.single
        ? `(select row_to_json(_embedded) from (${rows} limit 1) as _embedded)`
        : `coalesce((select json_agg(_embedded) from (${rows}) as _embedded), '[]'::json)`;
      return `${json} as ${quoteIdentifier(item.alias)}`;
    })
    .join(', ');
}
