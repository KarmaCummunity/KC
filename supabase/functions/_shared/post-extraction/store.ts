// supabase/functions/_shared/post-extraction/store.ts
// What the extraction function keeps in the database (FR-IMPORT-008, FR-IMPORT-009): the
// attempt log that the limits count, and the day cache of validated model answers. Written with
// the service role; the tables are in the store migration.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import type { ExtractionCache } from './extractPost.ts';

/** How long a cached answer is reused (FR-IMPORT-008 AC2). */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** One attempt, as recorded. No raw text: the fingerprint and the validated extraction only. */
export interface ImportRecord {
  user_id: string;
  channel: 'share' | 'paste';
  source_platform: 'whatsapp' | 'facebook' | 'yad2' | 'other' | 'unknown';
  text_fingerprint: string;
  routing: 'ready' | 'confirm' | 'manual';
  reason: string;
  confidence: number;
  extraction: unknown;
  extraction_version: string;
  model: string | null;
  provider_called: boolean;
}

export interface ImportStore {
  /** The member's attempts since the instant (cache hits and manual routes count). */
  attemptsSince(userId: string, sinceIso: string): Promise<number>;
  /** Model calls by everyone since the instant (the daily budget). */
  providerCallsSince(sinceIso: string): Promise<number>;
  /** Stores one attempt and returns its id. */
  record(row: ImportRecord): Promise<string>;
}

async function count(query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count: n, error } = await query;
  if (error) throw new Error(`import store: ${error.message}`);
  return n ?? 0;
}

export function supabaseImportStore(svc: SupabaseClient): ImportStore {
  const imports = () => svc.from('external_post_imports');
  return {
    attemptsSince: (userId, sinceIso) =>
      count(imports().select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sinceIso)),
    providerCallsSince: (sinceIso) =>
      count(imports().select('id', { count: 'exact', head: true }).eq('provider_called', true).gte('created_at', sinceIso)),
    async record(row) {
      const { data, error } = await imports().insert(row).select('id').single();
      if (error || !data) throw new Error(`import store: ${error?.message ?? 'no row returned'}`);
      return (data as { id: string }).id;
    },
  };
}

export function supabaseExtractionCache(svc: SupabaseClient, now: () => Date = () => new Date()): ExtractionCache {
  const table = () => svc.from('post_extraction_cache');
  return {
    async get(fingerprint, version) {
      const cutoff = new Date(now().getTime() - CACHE_TTL_MS).toISOString();
      const { data, error } = await table()
        .select('result')
        .eq('fingerprint', fingerprint)
        .eq('extraction_version', version)
        .gte('created_at', cutoff)
        .maybeSingle();
      if (error) throw new Error(`extraction cache: ${error.message}`);
      return (data as { result: unknown } | null)?.result ?? null;
    },
    async put(fingerprint, version, result) {
      const at = now();
      // Expired rows are cleared by the writer, so the table needs no job of its own.
      await table().delete().lt('created_at', new Date(at.getTime() - CACHE_TTL_MS).toISOString());
      const { error } = await table().upsert(
        { fingerprint, extraction_version: version, result, created_at: at.toISOString() },
        { onConflict: 'fingerprint' },
      );
      if (error) throw new Error(`extraction cache: ${error.message}`);
    },
  };
}
