// The server-owned translation pipeline (FR-TRANSLATE-002 single, FR-TRANSLATE-006
// batch). For every text: read it again under the caller's own rights (so a
// member can only translate what they can see, and a request cannot plant
// text), skip what needs no translation, answer from the cache, otherwise ask
// the provider and store the result for everyone.
//
// Ported from `supabase/functions/translate/{single,resolveBatch}.ts`: same
// input, same answers, same rules.

import { needsTranslation } from '@kc/domain';
import { resolveSource, type ResolvedSource } from './translatableSources';
import { cacheKeyOf, type CachedTranslationRow, type TranslationCache, type TranslationKey } from './translationCache';
import { isTranslatable, isUsableCachedTranslation, MAX_SOURCE_LENGTH, sameLanguageSkip } from './translationGuards';
import { type TranslationProvider, translateMany } from './translationProvider';

/** Provider calls in flight for one batch: the keyless provider throttles bursts. */
const PROVIDER_CONCURRENCY = 2;

/** One text to translate, as the app names it. */
export interface TranslationItem {
  readonly contentType: string;
  readonly contentId: string;
  readonly field: string;
}

export type TranslationStatus = 'translated' | 'cached' | 'skipped' | 'error';

export interface TranslationOutcome {
  readonly status: TranslationStatus;
  readonly translation?: CachedTranslationRow;
}

/** A batch answer names its item, so the app can match answers without relying on order alone. */
export type BatchOutcome = TranslationItem & TranslationOutcome;

/** Reads rows as the caller: row-level security decides what comes back. Rejects on a database error. */
export type SourceReader = (table: string, key: string, columns: readonly string[], ids: readonly string[]) => Promise<Record<string, unknown>[]>;

export interface TranslationDeps {
  readonly readSources: SourceReader;
  readonly cache: TranslationCache;
  readonly provider: TranslationProvider;
  /** Receives a failure the caller is not told about (for the log); `detail` never holds the text itself. */
  readonly warn: (event: string, detail: Readonly<Record<string, unknown>>) => void;
}

/** The caller may not see the row they asked to translate (or it does not exist). */
export class SourceNotVisibleError extends Error {
  constructor() {
    super('forbidden');
    this.name = 'SourceNotVisibleError';
  }
}

/** The provider could not translate a single-item request. */
export class ProviderFailedError extends Error {
  constructor(cause: unknown) {
    super('provider_failed', { cause });
    this.name = 'ProviderFailedError';
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

/** The text of a source row's column when it is worth a provider call, else null. */
function translatableText(row: Record<string, unknown> | undefined, column: string): string | null {
  const value = row?.[column];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_SOURCE_LENGTH || !isTranslatable(trimmed)) return null;
  return value;
}

/**
 * Stores a fresh translation and answers with what the cache now holds: this
 * request's row, or the row another request stored a moment earlier.
 */
async function store(cache: TranslationCache, row: CachedTranslationRow): Promise<TranslationOutcome> {
  if (await cache.putIfAbsent(row)) return { status: 'translated', translation: row };
  return { status: 'cached', translation: (await cache.get(row)) ?? row };
}

/**
 * Translates one text.
 * @throws SourceNotVisibleError when the caller cannot see the row.
 * @throws ProviderFailedError when the provider could not translate it.
 */
export async function translateOne(item: TranslationItem, targetLanguage: string, deps: TranslationDeps): Promise<TranslationOutcome> {
  const source = resolveSource(item.contentType, item.field);
  if (!source) return { status: 'skipped' };
  const [row] = await deps.readSources(source.table, source.key, [source.key, source.column], [item.contentId]);
  if (!row) throw new SourceNotVisibleError();

  const text = translatableText(row, source.column);
  if (text === null || sameLanguageSkip(text, targetLanguage)) return { status: 'skipped' };

  const key: TranslationKey = { ...item, targetLanguage };
  const cached = await deps.cache.get(key);
  if (cached && isUsableCachedTranslation(text, targetLanguage, cached)) return { status: 'cached', translation: cached };
  if (cached) await deps.cache.delete(key);

  const result = await deps.provider.translate({ text, targetLanguage }).catch((error: unknown) => {
    throw new ProviderFailedError(error);
  });
  if (!needsTranslation(result.detectedSourceLanguage, targetLanguage)) return { status: 'skipped' };
  return store(deps.cache, {
    ...key,
    sourceLanguage: result.detectedSourceLanguage,
    translatedText: result.translatedText,
    model: result.model,
    confidence: result.confidence,
  });
}

/** Reads the rows of a whole batch, one query per table. A table that cannot be read leaves its items skipped. */
async function readBatchSources(
  resolved: readonly (ResolvedSource | null)[],
  items: readonly TranslationItem[],
  deps: TranslationDeps,
): Promise<Map<string, Record<string, unknown>>> {
  const byTable = new Map<string, { key: string; ids: Set<string>; columns: Set<string> }>();
  resolved.forEach((source, index) => {
    if (!source) return;
    const group = byTable.get(source.table) ?? { key: source.key, ids: new Set<string>(), columns: new Set<string>() };
    group.ids.add((items[index] as TranslationItem).contentId);
    group.columns.add(source.column);
    byTable.set(source.table, group);
  });

  const rows = new Map<string, Record<string, unknown>>();
  for (const [table, group] of byTable) {
    try {
      const found = await deps.readSources(table, group.key, [group.key, ...group.columns], [...group.ids]);
      for (const row of found) rows.set(`${table}:${String(row[group.key])}`, row);
    } catch (error) {
      deps.warn('translation source read failed', { table, detail: describe(error) });
    }
  }
  return rows;
}

/**
 * Translates a batch; the answers are in the order of `items`. One item's
 * failure never fails the batch: it answers `error` (or `skipped`) and the app
 * shows the original text.
 */
export async function translateBatch(items: readonly TranslationItem[], targetLanguage: string, deps: TranslationDeps): Promise<BatchOutcome[]> {
  const resolved = items.map((item) => resolveSource(item.contentType, item.field));
  const rows = await readBatchSources(resolved, items, deps);
  const texts = items.map((item, index) => {
    const source = resolved[index];
    return source ? translatableText(rows.get(`${source.table}:${item.contentId}`), source.column) : null;
  });

  // One cache round trip for every item that has a text. A failed read is not fatal: every item is then translated.
  const cached = await deps.cache
    .getMany(targetLanguage, items.filter((_, index) => texts[index] !== null))
    .catch((error: unknown) => {
      deps.warn('translation cache read failed', { items: items.length, detail: describe(error) });
      return new Map<string, CachedTranslationRow>();
    });

  const outcomes = new Array<TranslationOutcome>(items.length);
  const misses: { index: number; text: string }[] = [];
  for (const [index, item] of items.entries()) {
    const text = texts[index] as string | null;
    if (text === null || sameLanguageSkip(text, targetLanguage)) {
      outcomes[index] = { status: 'skipped' };
      continue;
    }
    const hit = cached.get(cacheKeyOf(item));
    if (hit && isUsableCachedTranslation(text, targetLanguage, hit)) {
      outcomes[index] = { status: 'cached', translation: hit };
      continue;
    }
    // An unusable entry is removed so the fresh translation can take its place.
    if (hit) await deps.cache.delete({ ...item, targetLanguage }).catch((error: unknown) => deps.warn('translation cache delete failed', { field: item.field, detail: describe(error) }));
    misses.push({ index, text });
  }

  const translated = await translateMany(
    deps.provider,
    misses.map((miss) => ({ text: miss.text, targetLanguage })),
    PROVIDER_CONCURRENCY,
    (missIndex, error) => deps.warn('translation provider failed', { item: missIndex, detail: describe(error) }),
  );

  for (const [missIndex, miss] of misses.entries()) {
    const item = items[miss.index] as TranslationItem;
    const result = translated[missIndex];
    if (!result) {
      outcomes[miss.index] = { status: 'error' };
      continue;
    }
    // Nothing to show: the text was already in the reader's language, or came back unchanged.
    if (!needsTranslation(result.detectedSourceLanguage, targetLanguage) || result.translatedText.trim() === miss.text.trim()) {
      outcomes[miss.index] = { status: 'skipped' };
      continue;
    }
    const row: CachedTranslationRow = {
      ...item,
      targetLanguage,
      sourceLanguage: result.detectedSourceLanguage,
      translatedText: result.translatedText,
      model: result.model,
      confidence: result.confidence,
    };
    // The reader still gets the translation when it could not be stored.
    outcomes[miss.index] = await store(deps.cache, row).catch((error: unknown) => {
      deps.warn('translation cache write failed', { field: item.field, detail: describe(error) });
      return { status: 'translated' as const, translation: row };
    });
  }
  return items.map((item, index) => ({ contentType: item.contentType, contentId: item.contentId, field: item.field, ...(outcomes[index] as TranslationOutcome) }));
}
