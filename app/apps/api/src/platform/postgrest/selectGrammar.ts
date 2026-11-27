import { badRequest, unsupported } from './compatError';
import { splitTopLevel } from './filterGrammar';

/** One item of a `select=` list. */
export type SelectItem =
  | { kind: 'all' }
  | { kind: 'column'; column: string; alias: string }
  | { kind: 'embed'; relation: string; alias: string; inner: boolean; items: SelectItem[] };

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EMBED = /^([^(]+)\((.*)\)$/s;

/** Splits an optional `alias:` prefix off a select item. */
function splitAlias(text: string): { alias: string | null; rest: string } {
  const colon = text.indexOf(':');
  // `::` is a cast, which this engine does not implement; it is reported below.
  if (colon < 0 || text[colon + 1] === ':') return { alias: null, rest: text };
  return { alias: text.slice(0, colon), rest: text.slice(colon + 1) };
}

function parseItem(raw: string): SelectItem {
  if (raw === '*') return { kind: 'all' };
  const { alias, rest } = splitAlias(raw);
  if (alias !== null && !NAME.test(alias)) throw badRequest(`invalid alias in select: ${raw}`);

  const embed = EMBED.exec(rest);
  if (embed) {
    const [target = '', hint] = (embed[1] as string).split('!');
    if (!NAME.test(target)) throw badRequest(`invalid embedded resource in select: ${raw}`);
    if (hint !== undefined && hint !== 'inner' && hint !== 'left') throw unsupported(`embed hint "!${hint}"`);
    // `count()` and friends look like an embed with no columns; they are aggregates.
    if ((embed[2] as string) === '') throw unsupported(`aggregate "${raw}" in select`);
    return {
      kind: 'embed',
      relation: target,
      alias: alias ?? target,
      inner: hint === 'inner',
      items: parseSelect(embed[2] as string),
    };
  }

  if (!NAME.test(rest)) throw unsupported(`select item "${raw}" (casts, JSON paths and aggregates)`);
  return { kind: 'column', column: rest, alias: alias ?? rest };
}

/** Parses a `select=` value. An empty or missing value selects every column. */
export function parseSelect(raw: string | null | undefined): SelectItem[] {
  const compact = (raw ?? '').replace(/\s+/g, '');
  if (compact === '') return [{ kind: 'all' }];
  return splitTopLevel(compact, ',').map(parseItem);
}
