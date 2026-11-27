import { describe, expect, it } from 'vitest';
import { type CatalogQuery, loadSchemaCache, toFunctionSignature } from '../schemaCache';
import { createSchemaCacheSource } from '../schemaCacheSource';

const functionRow = (overrides: Record<string, unknown> = {}) => ({
  name: 'f',
  arg_names: ['p_a', 'p_b'],
  arg_modes: [],
  arg_types: ['uuid', 'integer'],
  default_count: 1,
  returns_set: false,
  return_type: 'int4',
  return_kind: 'b',
  ...overrides,
});

/** Answers the three catalog queries from canned rows, by what each one reads. */
function catalog(rows: { relations?: unknown[]; functions?: unknown[]; foreignKeys?: unknown[] }, calls = { count: 0 }): CatalogQuery {
  return ((text: string) => {
    calls.count += 1;
    if (text.includes('pg_proc')) return Promise.resolve({ rows: rows.functions ?? [] });
    if (text.includes('pg_constraint')) return Promise.resolve({ rows: rows.foreignKeys ?? [] });
    return Promise.resolve({ rows: rows.relations ?? [] });
  }) as CatalogQuery;
}

describe('toFunctionSignature', () => {
  it('marks the trailing arguments that have defaults', () => {
    expect(toFunctionSignature(functionRow())).toEqual({
      args: [
        { name: 'p_a', type: 'uuid', hasDefault: false },
        { name: 'p_b', type: 'integer', hasDefault: true },
      ],
      returns: 'scalar',
      returnsSet: false,
    });
  });

  it('keeps only input arguments', () => {
    const signature = toFunctionSignature(
      functionRow({ arg_names: ['p_a', 'out_id', 'out_name'], arg_modes: ['i', 't', 't'], arg_types: ['uuid', 'uuid', 'text'], default_count: 0 }),
    );

    expect(signature.args.map((arg) => arg.name)).toEqual(['p_a']);
  });

  it.each([
    ['void', 'p', 'void'],
    ['record', 'p', 'row'],
    ['posts', 'c', 'row'],
    ['jsonb', 'b', 'scalar'],
    ['post_status', 'e', 'scalar'],
  ])('classifies a %s return', (type, kind, expected) => {
    expect(toFunctionSignature(functionRow({ return_type: type, return_kind: kind })).returns).toBe(expected);
  });
});

describe('loadSchemaCache', () => {
  it('groups overloads by name and maps relations and foreign keys', async () => {
    const cache = await loadSchemaCache(
      catalog({
        relations: [{ name: 'books' }],
        functions: [functionRow(), functionRow({ arg_names: ['p_a'], arg_types: ['text'], default_count: 0 })],
        foreignKeys: [{ child: 'books', parent: 'authors', child_columns: ['author_id'], parent_columns: ['id'], child_unique: false }],
      }),
    );

    expect([...cache.relations]).toEqual(['books']);
    expect(cache.functions.get('f')).toHaveLength(2);
    expect(cache.foreignKeys).toEqual([
      { child: 'books', childColumns: ['author_id'], parent: 'authors', parentColumns: ['id'], childUnique: false },
    ]);
  });
});

describe('createSchemaCacheSource', () => {
  it('loads once and reuses the cache', async () => {
    const calls = { count: 0 };
    const source = createSchemaCacheSource(catalog({}, calls));

    await source.current();
    await source.current();

    expect(calls.count).toBe(3);
  });

  it('reloads on demand, but not more often than the cooldown', async () => {
    const calls = { count: 0 };
    let clock = 0;
    const source = createSchemaCacheSource(catalog({}, calls), () => clock);

    await source.current();
    await source.reload();
    expect(calls.count).toBe(3);

    clock = 31_000;
    await source.reload();
    expect(calls.count).toBe(6);
  });

  it('does not keep a failed load', async () => {
    let fail = true;
    const query = (() => (fail ? Promise.reject(new Error('catalog unavailable')) : Promise.resolve({ rows: [] }))) as CatalogQuery;
    const source = createSchemaCacheSource(query);

    await expect(source.current()).rejects.toThrow('catalog unavailable');
    fail = false;

    await expect(source.current()).resolves.toMatchObject({ relations: new Set() });
  });
});
