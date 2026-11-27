import { badRequest, unsupported } from './compatError';

/** Comparison operators of the PostgREST grammar this engine implements. */
const COMPARISONS = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'like',
  ilike: 'ilike',
} as const;
export type ComparisonOperator = keyof typeof COMPARISONS;

/** A parsed filter: one condition, or an `and` / `or` group of them. */
export type Filter =
  | { kind: 'compare'; column: string; operator: ComparisonOperator; value: string; negated: boolean }
  | { kind: 'in'; column: string; values: string[]; negated: boolean }
  | { kind: 'is'; column: string; value: IsValue; negated: boolean }
  | { kind: 'group'; operator: 'and' | 'or'; filters: Filter[]; negated: boolean };

const IS_VALUES = ['null', 'true', 'false', 'unknown'] as const;
type IsValue = (typeof IS_VALUES)[number];

/** SQL operator text of a comparison. */
export function sqlOperator(operator: ComparisonOperator): string {
  return COMPARISONS[operator];
}

/**
 * Splits `text` on `separator` at the top level only: separators inside
 * double quotes or parentheses belong to a value or a nested group.
 */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (quoted) {
      current += char;
      // A backslash keeps the next character literal, including a quote.
      if (char === '\\') current += text[(index += 1)] ?? '';
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** Removes the double quotes PostgREST uses around values with reserved characters. */
export function unquote(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
  return value.slice(1, -1).replace(/\\(.)/g, '$1');
}

/** `(a,b,"c,d")` → `['a', 'b', 'c,d']`. */
function parseList(raw: string): string[] {
  if (!raw.startsWith('(') || !raw.endsWith(')')) throw badRequest(`"in" needs a parenthesised list, got: ${raw}`);
  const inner = raw.slice(1, -1);
  return inner === '' ? [] : splitTopLevel(inner, ',').map(unquote);
}

/**
 * Parses the condition part of a filter: `eq.5`, `not.in.(1,2)`, `is.null`,
 * `ilike.*abc*`.
 * @param quotedValues Inside an `or=(…)` tree values may be double-quoted;
 *   a plain `column=eq.value` parameter is taken literally.
 */
export function parseCondition(column: string, raw: string, quotedValues: boolean): Filter {
  const negated = raw.startsWith('not.');
  const body = negated ? raw.slice(4) : raw;
  const dot = body.indexOf('.');
  if (dot < 0) throw badRequest(`filter on "${column}" has no operator: ${raw}`);
  const operator = body.slice(0, dot);
  const operand = body.slice(dot + 1);

  if (operator === 'in') return { kind: 'in', column, values: parseList(operand), negated };
  if (operator === 'is') {
    const value = IS_VALUES.find((candidate) => candidate === operand.toLowerCase());
    if (!value) throw badRequest(`"is" accepts null, true, false or unknown, got: ${operand}`);
    return { kind: 'is', column, value, negated };
  }
  if (!(operator in COMPARISONS)) throw unsupported(`filter operator "${operator}"`);
  const value = quotedValues ? unquote(operand) : operand;
  return { kind: 'compare', column, operator: operator as ComparisonOperator, value, negated };
}

const GROUP = /^(not\.)?(and|or)(\(.*\))$/s;

/** One member of a logic tree: a nested group or `column.operator.value`. */
function parseMember(member: string): Filter {
  const group = GROUP.exec(member);
  if (group) return parseGroup(group[2] as 'and' | 'or', group[3] as string, Boolean(group[1]));
  const dot = member.indexOf('.');
  if (dot < 1) throw badRequest(`malformed filter in a logic tree: ${member}`);
  return parseCondition(member.slice(0, dot), member.slice(dot + 1), true);
}

/** Parses the value of an `or=` / `and=` parameter: `(a.eq.1,and(b.gt.2,c.lt.3))`. */
export function parseGroup(operator: 'and' | 'or', raw: string, negated = false): Filter {
  if (!raw.startsWith('(') || !raw.endsWith(')')) throw badRequest(`"${operator}" needs a parenthesised list`);
  const members = splitTopLevel(raw.slice(1, -1), ',').filter((member) => member !== '');
  if (members.length === 0) throw badRequest(`"${operator}" needs at least one filter`);
  return { kind: 'group', operator, filters: members.map(parseMember), negated };
}
