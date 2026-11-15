// reconcile-storage-orphans — removes files no database row references (design §5.3
// "Cleanup"), against two ports. The database decides what an orphan is
// (kc_private.storage_orphan_keys); this worker lists, asks and deletes.
//
// A device uploads a file before it records the row, and a deleted post loses its rows
// before its files, so only objects older than `minAgeMs` are judged: a fresh upload is
// never taken for an orphan.
import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';

/** One row of a Storage listing; a folder has `id === null`. */
export interface ObjectEntry {
  readonly name: string;
  readonly id: string | null;
  readonly created_at?: string | null;
}

export interface OrphanDatabase {
  /** Of `keys` in `bucket`, those no row references; empty for a bucket that is not recorded row by row. */
  orphanKeys(bucket: string, keys: string[]): Promise<string[]>;
}

export interface OrphanStorage {
  list(bucket: string, prefix: string, offset: number, limit: number): Promise<ObjectEntry[]>;
  remove(bucket: string, paths: string[]): Promise<void>;
}

export interface OrphanDeps {
  readonly db: OrphanDatabase;
  readonly storage: OrphanStorage;
  readonly serviceRoleKey: string;
  readonly report: (error: unknown, tags: { stage: 'scan' | 'remove'; bucket: string }) => Promise<void>;
  /** Buckets whose objects are recorded row by row. */
  readonly buckets?: readonly string[];
  readonly minAgeMs?: number;
  readonly now?: () => number;
}

export const RECONCILED_BUCKETS = ['post-images'] as const;
export const MIN_AGE_MS = 24 * 60 * 60 * 1000;
const PAGE = 100;
const ASK = 500;
/** `<user_id>/<batch>/<file>` plus one level of slack. */
const MAX_DEPTH = 4;

/** Paths of the objects under `prefix` that were created before `before`. */
async function oldObjects(storage: OrphanStorage, bucket: string, prefix: string, before: number, depth = MAX_DEPTH): Promise<string[]> {
  if (depth <= 0) return [];
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await storage.list(bucket, prefix, offset, PAGE);
    for (const entry of page) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) paths.push(...(await oldObjects(storage, bucket, path, before, depth - 1)));
      // An object without a readable creation time is left alone.
      else if (entry.created_at && Date.parse(entry.created_at) < before) paths.push(path);
    }
    if (page.length < PAGE) break;
  }
  return paths;
}

const chunks = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

export interface OrphanSummary {
  scanned: number;
  removed: number;
  errors: number;
}

export async function reconcile(deps: OrphanDeps): Promise<OrphanSummary> {
  const summary: OrphanSummary = { scanned: 0, removed: 0, errors: 0 };
  const before = (deps.now ?? Date.now)() - (deps.minAgeMs ?? MIN_AGE_MS);
  for (const bucket of deps.buckets ?? RECONCILED_BUCKETS) {
    let orphans: string[] = [];
    try {
      const candidates = await oldObjects(deps.storage, bucket, '', before);
      summary.scanned += candidates.length;
      for (const keys of chunks(candidates, ASK)) orphans.push(...(await deps.db.orphanKeys(bucket, keys)));
    } catch (error) {
      // A bucket that cannot be read completely is not cleaned at all in this run.
      summary.errors += 1;
      orphans = [];
      await deps.report(error, { stage: 'scan', bucket });
    }
    for (const paths of chunks(orphans, PAGE)) {
      try {
        await deps.storage.remove(bucket, paths);
        summary.removed += paths.length;
      } catch (error) {
        summary.errors += paths.length;
        await deps.report(error, { stage: 'remove', bucket });
      }
    }
  }
  return summary;
}

export function createOrphanHandler(deps: OrphanDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    if (!isServiceRoleRequest(req, deps.serviceRoleKey)) return serviceRoleRequiredResponse();
    const summary = await reconcile(deps);
    return new Response(JSON.stringify({ ok: true, ...summary }), { headers: { 'Content-Type': 'application/json' } });
  };
}

export const ORPHAN_SQL = 'select k as key from kc_private.storage_orphan_keys($1::text, $2::text[]) k';

export type Query = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export function createOrphanDatabase(query: Query): OrphanDatabase {
  return {
    async orphanKeys(bucket, keys) {
      if (keys.length === 0) return [];
      return (await query(ORPHAN_SQL, [bucket, keys])).map((row) => String(row.key));
    },
  };
}
