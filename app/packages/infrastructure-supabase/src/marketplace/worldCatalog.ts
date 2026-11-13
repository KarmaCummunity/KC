// The giving worlds' display labels (`worlds`), read once per client.
//
// A listing detail names its world in both languages. The worlds are a handful of seeded rows that
// only a migration changes, so one read serves every detail opened in the session instead of one
// round trip per open (NFR-PERF-005).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type Client = SupabaseClient<Database>;

export interface WorldLabels {
  readonly labelHe: string;
  readonly labelEn: string;
}

const cache = new WeakMap<object, Promise<ReadonlyMap<string, WorldLabels>>>();

async function readWorlds(client: Client): Promise<ReadonlyMap<string, WorldLabels>> {
  const rows = unwrapCall('table:worlds', await client.from('worlds').select('slug, label_he, label_en'));
  return new Map((rows ?? []).map((row) => [row.slug, { labelHe: row.label_he, labelEn: row.label_en }]));
}

/** The labels by world slug; a failed read is not cached, so the next call retries. */
export function loadWorldLabels(client: Client): Promise<ReadonlyMap<string, WorldLabels>> {
  const cached = cache.get(client);
  if (cached) return cached;
  const pending = readWorlds(client);
  cache.set(client, pending);
  pending.catch(() => cache.delete(client));
  return pending;
}
