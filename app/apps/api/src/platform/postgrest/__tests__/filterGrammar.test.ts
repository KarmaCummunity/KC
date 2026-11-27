import { describe, expect, it } from 'vitest';
import { PostgrestCompatError } from '../compatError';
import { parseCondition, parseGroup, splitTopLevel, unquote } from '../filterGrammar';

describe('filter grammar', () => {
  it('parses a comparison and keeps the value literal', () => {
    expect(parseCondition('title', 'eq.a.b,c', false)).toEqual({
      kind: 'compare',
      column: 'title',
      operator: 'eq',
      value: 'a.b,c',
      negated: false,
    });
  });

  it('parses negation, lists and is', () => {
    expect(parseCondition('id', 'not.in.(1,2)', false)).toEqual({ kind: 'in', column: 'id', values: ['1', '2'], negated: true });
    expect(parseCondition('id', 'in.()', false)).toMatchObject({ values: [] });
    expect(parseCondition('deleted_at', 'is.NULL', false)).toEqual({ kind: 'is', column: 'deleted_at', value: 'null', negated: false });
  });

  it('keeps commas and parentheses inside a quoted list value', () => {
    expect(parseCondition('name', 'in.("a,b","c(d)",e)', false)).toMatchObject({ values: ['a,b', 'c(d)', 'e'] });
  });

  it('parses the keyset filter the adapters build', () => {
    const tree = parseGroup('or', '(created_at.lt.2026-01-01T00:00:00Z,and(created_at.eq.2026-01-01T00:00:00Z,id.lt.abc))');

    expect(tree).toEqual({
      kind: 'group',
      operator: 'or',
      negated: false,
      filters: [
        { kind: 'compare', column: 'created_at', operator: 'lt', value: '2026-01-01T00:00:00Z', negated: false },
        {
          kind: 'group',
          operator: 'and',
          negated: false,
          filters: [
            { kind: 'compare', column: 'created_at', operator: 'eq', value: '2026-01-01T00:00:00Z', negated: false },
            { kind: 'compare', column: 'id', operator: 'lt', value: 'abc', negated: false },
          ],
        },
      ],
    });
  });

  it('unquotes values in a logic tree, so user text cannot add a predicate', () => {
    const tree = parseGroup('or', '(display_name.ilike."%a,b.eq.1\\"%",share_handle.ilike."%x%")');

    expect(tree).toMatchObject({
      filters: [
        { column: 'display_name', operator: 'ilike', value: '%a,b.eq.1"%' },
        { column: 'share_handle', operator: 'ilike', value: '%x%' },
      ],
    });
  });

  it('splits only at the top level', () => {
    expect(splitTopLevel('a,(b,c),"d,e",f', ',')).toEqual(['a', '(b,c)', '"d,e"', 'f']);
    expect(unquote('"a\\\\b"')).toBe('a\\b');
    expect(unquote('plain')).toBe('plain');
  });

  it.each([
    ['an unknown operator', () => parseCondition('a', 'fts.word', false)],
    ['a missing operator', () => parseCondition('a', 'value', false)],
    ['a bad "is" value', () => parseCondition('a', 'is.maybe', false)],
    ['an unparenthesised list', () => parseCondition('a', 'in.1,2', false)],
    ['an unparenthesised group', () => parseGroup('or', 'a.eq.1')],
    ['an empty group', () => parseGroup('or', '()')],
    ['a group member without a column', () => parseGroup('or', '(.eq.1)')],
  ])('rejects %s', (_case, parse) => {
    expect(parse).toThrow(PostgrestCompatError);
  });
});
