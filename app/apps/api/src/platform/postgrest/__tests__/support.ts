import type { SchemaCacheSource } from '../engine';
import type { SchemaCache } from '../schemaCache';

/** A small schema: authors write books; each author has one profile row. */
export const TEST_CACHE: SchemaCache = {
  relations: new Set(['authors', 'books', 'profiles']),
  functions: new Map([
    ['ping', [{ args: [], returns: 'void', returnsSet: false }]],
    ['book_count', [{ args: [{ name: 'p_author', type: 'uuid', hasDefault: false }], returns: 'scalar', returnsSet: false }]],
    ['tags_of', [{ args: [{ name: 'p_book', type: 'uuid', hasDefault: false }], returns: 'scalar', returnsSet: true }]],
    ['publish_book', [{ args: [{ name: 'p_book', type: 'uuid', hasDefault: false }], returns: 'row', returnsSet: false }]],
    [
      'search_books',
      [
        {
          args: [
            { name: 'p_query', type: 'text', hasDefault: false },
            { name: 'p_limit', type: 'integer', hasDefault: true },
          ],
          returns: 'row',
          returnsSet: true,
        },
      ],
    ],
    [
      'overloaded',
      [
        { args: [{ name: 'p_a', type: 'text', hasDefault: false }], returns: 'scalar', returnsSet: false },
        { args: [{ name: 'p_a', type: 'integer', hasDefault: false }], returns: 'scalar', returnsSet: false },
      ],
    ],
  ]),
  foreignKeys: [
    { child: 'books', childColumns: ['author_id'], parent: 'authors', parentColumns: ['id'], childUnique: false },
    { child: 'profiles', childColumns: ['author_id'], parent: 'authors', parentColumns: ['id'], childUnique: true },
  ],
};

/** A cache source that counts reloads and can swap in a newer cache. */
export function cacheSource(initial: SchemaCache = TEST_CACHE, afterReload: SchemaCache = initial) {
  const source = {
    reloads: 0,
    current: () => Promise.resolve(initial),
    reload: () => {
      source.reloads += 1;
      return Promise.resolve(afterReload);
    },
  };
  return source satisfies SchemaCacheSource & { reloads: number };
}

export const BASE = 'http://kc-api.internal/rest/v1';
