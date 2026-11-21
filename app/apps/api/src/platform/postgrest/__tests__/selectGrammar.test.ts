import { describe, expect, it } from 'vitest';
import { PostgrestCompatError } from '../compatError';
import { parseSelect } from '../selectGrammar';

describe('select grammar', () => {
  it('selects everything when nothing is asked', () => {
    expect(parseSelect(null)).toEqual([{ kind: 'all' }]);
    expect(parseSelect('  ')).toEqual([{ kind: 'all' }]);
  });

  it('parses columns, aliases and whitespace', () => {
    expect(parseSelect('id, title, written:created_at')).toEqual([
      { kind: 'column', column: 'id', alias: 'id' },
      { kind: 'column', column: 'title', alias: 'title' },
      { kind: 'column', column: 'created_at', alias: 'written' },
    ]);
  });

  it('parses embedded resources, with inner joins, aliases and nesting', () => {
    expect(parseSelect('id,author:authors!inner(name,profiles(bio)),*')).toEqual([
      { kind: 'column', column: 'id', alias: 'id' },
      {
        kind: 'embed',
        relation: 'authors',
        alias: 'author',
        inner: true,
        items: [
          { kind: 'column', column: 'name', alias: 'name' },
          { kind: 'embed', relation: 'profiles', alias: 'profiles', inner: false, items: [{ kind: 'column', column: 'bio', alias: 'bio' }] },
        ],
      },
      { kind: 'all' },
    ]);
  });

  it.each(['title::text', 'data->key', 'count()', 'authors!fk_name(id)', '1bad:col', 'bad-name(id)'])(
    'rejects %s',
    (select) => {
      expect(() => parseSelect(select)).toThrow(PostgrestCompatError);
    },
  );
});
