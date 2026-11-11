import { backendObjectKind } from '../rpc/backendUnavailable';

/**
 * True when PostgREST reports a table, view or column that is not in the schema cache
 * (HTTP 404 + `PGRST205` / `PGRST204`, common when a migration was not applied yet).
 * New code uses `isBackendObjectMissing` / `unwrapCall` from `rpc/`, which also cover
 * functions, grants, Edge Functions and buckets; this narrower test stays for the
 * adapters that treat a missing relation as "no rows".
 */
export function isPostgrestRelationMissing(error: {
  code?: string;
  message?: string;
}): boolean {
  const kind = backendObjectKind(error);
  return kind === 'relation' || kind === 'column';
}
