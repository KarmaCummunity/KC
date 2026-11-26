import type { SchemaCacheSource } from './engine';
import { type CatalogQuery, loadSchemaCache, type SchemaCache } from './schemaCache';

/** Shortest time between two reloads, so a stream of misses cannot hammer the catalog. */
const RELOAD_COOLDOWN_MS = 30_000;

/**
 * Loads the schema cache on first use and keeps it for the life of the
 * process. A deploy that adds a table or function restarts the API; a miss in
 * between (a migration applied to a running API) triggers one reload.
 * @param now Injected clock, for tests.
 */
export function createSchemaCacheSource(query: CatalogQuery, now: () => number = Date.now): SchemaCacheSource {
  let loading: Promise<SchemaCache> | undefined;
  let loadedAt = 0;

  const load = (): Promise<SchemaCache> => {
    loadedAt = now();
    loading = loadSchemaCache(query).catch((error: unknown) => {
      // A failed load must not be cached: the next request tries again.
      loading = undefined;
      throw error;
    });
    return loading;
  };

  return {
    current: () => loading ?? load(),
    reload: () => (loading && now() - loadedAt < RELOAD_COOLDOWN_MS ? loading : load()),
  };
}
