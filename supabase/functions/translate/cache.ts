// supabase/functions/translate/cache.ts
// Service-role get/insert over content_translations. Writes bypass RLS + grants.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export interface CacheKey {
  contentType: string;
  contentId: string;
  field: string;
  targetLanguage: string;
}

export interface CacheRow extends CacheKey {
  sourceLanguage: string | null;
  translatedText: string;
  model: string | null;
  confidence: number | null;
}

const COLUMNS =
  'content_type, content_id, field, target_language, source_language, translated_text, model, confidence';

export async function getCached(svc: SupabaseClient, key: CacheKey): Promise<CacheRow | null> {
  const { data, error } = await svc
    .from('content_translations')
    .select(COLUMNS)
    .eq('content_type', key.contentType)
    .eq('content_id', key.contentId)
    .eq('field', key.field)
    .eq('target_language', key.targetLanguage)
    .maybeSingle();
  if (error) throw new Error(`getCached: ${error.message}`);
  return data ? mapRow(data) : null;
}

/** The in-memory key of a cached row: its content type, id and field (the language is fixed per batch). */
export function cacheKeyOf(key: Omit<CacheKey, 'targetLanguage'>): string {
  return `${key.contentType}|${key.contentId}|${key.field}`;
}

/**
 * The cached rows of a whole batch in one round-trip (#1798): one read by target language and
 * content id, matched in memory by type, id and field. A row of another type or field that shares
 * an id is read but never matched. Returns a map keyed by `cacheKeyOf`.
 */
export async function getCachedMany(
  svc: SupabaseClient,
  targetLanguage: string,
  keys: Omit<CacheKey, 'targetLanguage'>[],
): Promise<Map<string, CacheRow>> {
  const found = new Map<string, CacheRow>();
  const ids = [...new Set(keys.map((k) => k.contentId))];
  if (ids.length === 0) return found;
  const { data, error } = await svc
    .from('content_translations')
    .select(COLUMNS)
    .eq('target_language', targetLanguage)
    .in('content_id', ids);
  if (error) throw new Error(`getCachedMany: ${error.message}`);
  const wanted = new Set(keys.map(cacheKeyOf));
  for (const d of (data ?? []) as Record<string, unknown>[]) {
    const row = mapRow(d);
    const key = cacheKeyOf(row);
    if (wanted.has(key)) found.set(key, row);
  }
  return found;
}

/** Returns true if this call inserted; false if a row already existed (23505). */
export async function putIfAbsent(svc: SupabaseClient, row: CacheRow): Promise<boolean> {
  const { error } = await svc.from('content_translations').insert({
    content_type: row.contentType,
    content_id: row.contentId,
    field: row.field,
    target_language: row.targetLanguage,
    source_language: row.sourceLanguage,
    translated_text: row.translatedText,
    model: row.model,
    confidence: row.confidence,
  });
  if (!error) return true;
  if ((error as { code?: string }).code === '23505') return false;
  throw new Error(`putIfAbsent: ${error.message}`);
}

/** Drop a cache row so a fresh translate can insert (poison / identical-text recovery). */
export async function deleteCached(svc: SupabaseClient, key: CacheKey): Promise<void> {
  const { error } = await svc
    .from('content_translations')
    .delete()
    .eq('content_type', key.contentType)
    .eq('content_id', key.contentId)
    .eq('field', key.field)
    .eq('target_language', key.targetLanguage);
  if (error) throw new Error(`deleteCached: ${error.message}`);
}

function mapRow(d: Record<string, unknown>): CacheRow {
  return {
    contentType: d.content_type as string,
    contentId: d.content_id as string,
    field: d.field as string,
    targetLanguage: d.target_language as string,
    sourceLanguage: (d.source_language as string | null) ?? null,
    translatedText: d.translated_text as string,
    model: (d.model as string | null) ?? null,
    confidence: (d.confidence as number | null) ?? null,
  };
}
