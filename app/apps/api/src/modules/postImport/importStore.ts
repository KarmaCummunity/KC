// What the import keeps in the database (FR-IMPORT-008, FR-IMPORT-009): the
// attempt log the limits count, the day cache of validated model answers, and
// the lookups in the official place catalog. All over the service role: the
// member never writes these tables.
//
// Ported from `supabase/functions/_shared/post-extraction/{store,catalog}.ts`.

import type { SqlBackedClient } from '../../platform/postgrest/sqlBackedClient';
import type { ExtractionCache } from './extractPost';
import type { PlaceCandidate, PlaceResolver } from './placeDecision';

/** The similarity from which an import counts as repeating one of the member's open posts (FR-IMPORT-008 AC1). */
export const CROSS_POST_MIN_SIMILARITY = 0.8;
/** How long a cached answer is reused (FR-IMPORT-008 AC2). */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Rows asked per place lookup: three suggestions plus the runner-up the margin needs. */
const PLACE_CANDIDATES = 5;
/** PostgreSQL invalid_parameter_value: the catalog refuses the query (too short, only symbols). */
const INVALID_PARAMETER = '22023';

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
  /** The member's open post this import repeats, when the cross-post guard found one (AC1). */
  duplicate_post_id: string | null;
}

/** Every method rejects on a database error: a limit that cannot be read must never read as "no limit". */
export interface ImportStore {
  /** The member's attempts since the instant (cache hits and manual routes count). */
  attemptsSince(userId: string, sinceIso: string): Promise<number>;
  /** Model calls by everyone since the instant (the daily budget). */
  providerCallsSince(sinceIso: string): Promise<number>;
  /** The member's open post the text repeats (trigram similarity at or above the guard), or null (AC1). */
  similarOpenPost(userId: string, text: string): Promise<string | null>;
  /** When moderation removed the member's imported posts since the instant (the lockout, AC4). */
  moderationRemovalsSince(userId: string, sinceIso: string): Promise<Date[]>;
  /** Stores one attempt and returns its id. */
  record(row: ImportRecord): Promise<string>;
}

async function countOf(query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(`import store: ${error.message}`);
  return count ?? 0;
}

/** @param service A client that acts as the service role (`PortClients.serviceClient`). */
export function createSqlImportStore(service: SqlBackedClient): ImportStore {
  const imports = () => service.from('external_post_imports');
  return {
    attemptsSince: (userId, sinceIso) => countOf(imports().select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sinceIso)),
    providerCallsSince: (sinceIso) => countOf(imports().select('id', { count: 'exact', head: true }).eq('provider_called', true).gte('created_at', sinceIso)),
    async similarOpenPost(userId, text) {
      const { data, error } = await service.rpc('import_similar_open_post', { p_user_id: userId, p_text: text, p_min: CROSS_POST_MIN_SIMILARITY });
      if (error) throw new Error(`import store: ${error.message}`);
      return ((data as { post_id: string }[] | null) ?? [])[0]?.post_id ?? null;
    },
    async moderationRemovalsSince(userId, sinceIso) {
      const { data, error } = await service.rpc('import_moderation_removals', { p_user_id: userId, p_since: sinceIso });
      if (error) throw new Error(`import store: ${error.message}`);
      return ((data as string[] | null) ?? []).map((at) => new Date(at));
    },
    async record(row) {
      const { data, error } = await imports().insert(row).select('id').single();
      if (error || !data) throw new Error(`import store: ${error?.message ?? 'no row returned'}`);
      return (data as { id: string }).id;
    },
  };
}

/** The day cache of validated answers, keyed by the text's fingerprint. */
export function createSqlExtractionCache(service: SqlBackedClient, now: () => Date = () => new Date()): ExtractionCache {
  const table = () => service.from('post_extraction_cache');
  const cutoffIso = (at: Date) => new Date(at.getTime() - CACHE_TTL_MS).toISOString();
  return {
    async get(fingerprint, version) {
      const { data, error } = await table()
        .select('result')
        .eq('fingerprint', fingerprint)
        .eq('extraction_version', version)
        .gte('created_at', cutoffIso(now()))
        .maybeSingle();
      if (error) throw new Error(`extraction cache: ${error.message}`);
      return (data as { result: unknown } | null)?.result ?? null;
    },
    async put(fingerprint, version, result) {
      const at = now();
      // Expired rows are cleared by the writer, so the table needs no job of its own.
      await table().delete().lt('created_at', cutoffIso(at));
      const { error } = await table().upsert({ fingerprint, extraction_version: version, result, created_at: at.toISOString() }, { onConflict: 'fingerprint' });
      if (error) throw new Error(`extraction cache: ${error.message}`);
    },
  };
}

interface ResolveRow {
  place_id: string;
  name_he: string;
  city_id: string | null;
  score: number;
  margin: number;
}

/** The place resolver of the pipeline, backed by `api_resolve_place` (FR-IMPORT-004). */
export function createSqlPlaceResolver(service: SqlBackedClient): PlaceResolver {
  return async (level, text, cityId): Promise<PlaceCandidate[]> => {
    const { data, error } = await service.rpc('api_resolve_place', { p_level: level, p_text: text, p_city_id: cityId, p_limit: PLACE_CANDIDATES });
    // A query the catalog refuses simply has no candidates.
    if (error) {
      if (error.code === INVALID_PARAMETER) return [];
      throw new Error(`place resolution: ${error.message}`);
    }
    return ((data ?? []) as ResolveRow[]).map((row) => ({
      level,
      placeId: row.place_id,
      nameHe: row.name_he,
      cityId: row.city_id,
      score: Number(row.score),
      margin: Number(row.margin),
    }));
  };
}
