import type { SqlBackedClient } from '../../platform/postgrest/sqlBackedClient';

/** What identifies one cached translation. */
export interface TranslationKey {
  readonly contentType: string;
  readonly contentId: string;
  readonly field: string;
  readonly targetLanguage: string;
}

/** A row of `public.content_translations`, as the app's `CachedTranslation`. */
export interface CachedTranslationRow extends TranslationKey {
  readonly sourceLanguage: string | null;
  readonly translatedText: string;
  readonly model: string | null;
  readonly confidence: number | null;
}

/** `public.content_translations`. Every method rejects on a database error. */
export interface TranslationCache {
  get(key: TranslationKey): Promise<CachedTranslationRow | null>;
  /** The cached rows of a batch, keyed by `cacheKeyOf`. */
  getMany(targetLanguage: string, keys: readonly Omit<TranslationKey, 'targetLanguage'>[]): Promise<Map<string, CachedTranslationRow>>;
  /** @returns true when this call stored the row, false when one was already there. */
  putIfAbsent(row: CachedTranslationRow): Promise<boolean>;
  /** Removes a row so a fresh translation can be stored (a poisoned or identical-text entry). */
  delete(key: TranslationKey): Promise<void>;
}

const COLUMNS = 'content_type, content_id, field, target_language, source_language, translated_text, model, confidence';
/** PostgreSQL unique_violation: another request stored the same translation first. */
const UNIQUE_VIOLATION = '23505';

/** The in-memory key of a cached row within one batch: the target language is the same for all of it. */
export function cacheKeyOf(key: Omit<TranslationKey, 'targetLanguage'>): string {
  return `${key.contentType}|${key.contentId}|${key.field}`;
}

function toRow(record: Record<string, unknown>): CachedTranslationRow {
  return {
    contentType: record.content_type as string,
    contentId: record.content_id as string,
    field: record.field as string,
    targetLanguage: record.target_language as string,
    sourceLanguage: (record.source_language as string | null) ?? null,
    translatedText: record.translated_text as string,
    model: (record.model as string | null) ?? null,
    confidence: (record.confidence as number | null) ?? null,
  };
}

/**
 * The cache over the service role: members may read translations of content
 * they can see, and only the server writes them, after reading the source
 * text itself.
 * @param service A client that acts as the service role (`PortClients.serviceClient`).
 */
export function createSqlTranslationCache(service: SqlBackedClient): TranslationCache {
  const table = () => service.from('content_translations');
  const oneRow = (key: TranslationKey) => ({
    content_type: key.contentType,
    content_id: key.contentId,
    field: key.field,
    target_language: key.targetLanguage,
  });
  return {
    async get(key) {
      const { data, error } = await table().select(COLUMNS).match(oneRow(key)).maybeSingle();
      if (error) throw new Error(`translation cache read: ${error.message}`);
      return data ? toRow(data as Record<string, unknown>) : null;
    },
    async getMany(targetLanguage, keys) {
      const found = new Map<string, CachedTranslationRow>();
      const ids = [...new Set(keys.map((key) => key.contentId))];
      if (ids.length === 0) return found;
      // One round trip by language and content id; a row of another type or field that shares an id is read but never matched.
      const { data, error } = await table().select(COLUMNS).eq('target_language', targetLanguage).in('content_id', ids);
      if (error) throw new Error(`translation cache read: ${error.message}`);
      const wanted = new Set(keys.map(cacheKeyOf));
      for (const record of (data ?? []) as Record<string, unknown>[]) {
        const row = toRow(record);
        if (wanted.has(cacheKeyOf(row))) found.set(cacheKeyOf(row), row);
      }
      return found;
    },
    async putIfAbsent(row) {
      const { error } = await table().insert({
        ...oneRow(row),
        source_language: row.sourceLanguage,
        translated_text: row.translatedText,
        model: row.model,
        confidence: row.confidence,
      });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false;
      throw new Error(`translation cache write: ${error.message}`);
    },
    async delete(key) {
      const { error } = await table().delete().match(oneRow(key));
      if (error) throw new Error(`translation cache delete: ${error.message}`);
    },
  };
}
