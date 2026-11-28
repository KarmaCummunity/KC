import { describe, expect, it } from 'vitest';
import { cacheKeyOf, type CachedTranslationRow, type TranslationCache, type TranslationKey } from '../translationCache';
import type { ProviderInput, ProviderResult } from '../translationProvider';
import { ProviderFailedError, SourceNotVisibleError, translateBatch, type TranslationDeps, translateOne } from '../translationService';

const POST_ID = '11111111-1111-4111-8111-111111111111';
const COMMENT_ID = '22222222-2222-4222-8222-222222222222';
const HEBREW_TITLE = 'ספה כחולה למסירה';
const TITLE = { contentType: 'post', contentId: POST_ID, field: 'title' };

const fullKey = (key: TranslationKey) => `${key.targetLanguage}|${cacheKeyOf(key)}`;
const cachedRow = (overrides: Partial<CachedTranslationRow> = {}): CachedTranslationRow => ({
  ...TITLE,
  targetLanguage: 'en',
  sourceLanguage: 'he',
  translatedText: 'Blue sofa to give away',
  model: 'm',
  confidence: 0.9,
  ...overrides,
});

interface Options {
  /** The rows the caller can see, by table. */
  readonly rows?: Record<string, Record<string, unknown>[]>;
  readonly cached?: CachedTranslationRow[];
  readonly translate?: (input: ProviderInput) => Promise<ProviderResult>;
  /** Cache operations that fail, to check that a batch survives them. */
  readonly failing?: ReadonlySet<'getMany' | 'putIfAbsent'>;
  /** Tables whose read fails. */
  readonly unreadable?: ReadonlySet<string>;
}

/** The pipeline over an in-memory cache, with every outside call recorded. */
function setup(options: Options = {}) {
  const store = new Map<string, CachedTranslationRow>((options.cached ?? []).map((row) => [fullKey(row), row]));
  const sourceReads: Array<{ table: string; key: string; columns: readonly string[]; ids: readonly string[] }> = [];
  const cacheReads: Array<{ targetLanguage: string; ids: string[] }> = [];
  const providerCalls: ProviderInput[] = [];
  const warnings: string[] = [];

  const cache: TranslationCache = {
    get: (key) => Promise.resolve(store.get(fullKey(key)) ?? null),
    getMany: (targetLanguage, keys) => {
      if (options.failing?.has('getMany')) return Promise.reject(new Error('offline'));
      cacheReads.push({ targetLanguage, ids: [...new Set(keys.map((key) => key.contentId))] });
      const found = keys.map((key) => store.get(fullKey({ ...key, targetLanguage }))).filter((row) => row !== undefined);
      return Promise.resolve(new Map(found.map((row) => [cacheKeyOf(row), row])));
    },
    putIfAbsent: (row) => {
      if (options.failing?.has('putIfAbsent')) return Promise.reject(new Error('offline'));
      if (store.has(fullKey(row))) return Promise.resolve(false);
      store.set(fullKey(row), row);
      return Promise.resolve(true);
    },
    delete: (key) => Promise.resolve(void store.delete(fullKey(key))),
  };
  const deps: TranslationDeps = {
    readSources: (table, key, columns, ids) => {
      sourceReads.push({ table, key, columns, ids });
      if (options.unreadable?.has(table)) return Promise.reject(new Error('permission denied'));
      return Promise.resolve((options.rows?.[table] ?? []).filter((row) => ids.includes(String(row[key]))));
    },
    cache,
    provider: {
      translate: (input) => {
        providerCalls.push(input);
        return (options.translate ?? (() => Promise.resolve({ translatedText: 'Blue sofa', detectedSourceLanguage: 'he', confidence: 0.8, model: 'fake' })))(input);
      },
    },
    warn: (event) => warnings.push(event),
  };
  return { deps, store, sourceReads, cacheReads, providerCalls, warnings };
}

const visiblePost = { posts: [{ id: POST_ID, title: HEBREW_TITLE, description: 'כמעט חדשה' }] };

describe('translateOne', () => {
  it('reads the text under the caller\'s rights, translates it and stores it for everyone', async () => {
    const { deps, store, sourceReads, providerCalls } = setup({ rows: visiblePost });

    const outcome = await translateOne(TITLE, 'en', deps);

    expect(sourceReads).toEqual([{ table: 'posts', key: 'id', columns: ['id', 'title'], ids: [POST_ID] }]);
    expect(providerCalls).toEqual([{ text: HEBREW_TITLE, targetLanguage: 'en' }]);
    expect(outcome).toEqual({
      status: 'translated',
      translation: { ...TITLE, targetLanguage: 'en', sourceLanguage: 'he', translatedText: 'Blue sofa', model: 'fake', confidence: 0.8 },
    });
    expect(store.size).toBe(1);
  });

  it('answers from the cache without a provider call', async () => {
    const { deps, providerCalls } = setup({ rows: visiblePost, cached: [cachedRow()] });

    const outcome = await translateOne(TITLE, 'en', deps);

    expect(outcome).toEqual({ status: 'cached', translation: cachedRow() });
    expect(providerCalls).toEqual([]);
  });

  it('refuses a row the caller cannot see before any cache or provider work', async () => {
    const { deps, providerCalls } = setup({ rows: { posts: [] }, cached: [cachedRow()] });

    await expect(translateOne(TITLE, 'en', deps)).rejects.toBeInstanceOf(SourceNotVisibleError);
    expect(providerCalls).toEqual([]);
  });

  it.each([
    ['a field outside the registry', { ...TITLE, field: 'display_name' }, 'en', visiblePost],
    ['text already in the reader\'s language', TITLE, 'he', visiblePost],
    ['text that is not language', TITLE, 'en', { posts: [{ id: POST_ID, title: '12:30' }] }],
    ['an empty text', TITLE, 'en', { posts: [{ id: POST_ID, title: null }] }],
  ])('skips %s without a provider call', async (_label, item, target, rows) => {
    const { deps, providerCalls } = setup({ rows });

    expect(await translateOne(item, target, deps)).toEqual({ status: 'skipped' });
    expect(providerCalls).toEqual([]);
  });

  it('replaces a cached entry that only repeats the source text', async () => {
    const poisoned = cachedRow({ translatedText: HEBREW_TITLE });
    const { deps, store } = setup({ rows: visiblePost, cached: [poisoned] });

    const outcome = await translateOne(TITLE, 'en', deps);

    expect(outcome.status).toBe('translated');
    expect([...store.values()].map((row) => row.translatedText)).toEqual(['Blue sofa']);
  });

  it('stores nothing when the provider finds the text is already in the target language', async () => {
    const { deps, store } = setup({
      rows: { posts: [{ id: POST_ID, title: 'Синий диван' }] },
      translate: () => Promise.resolve({ translatedText: 'Синий диван', detectedSourceLanguage: 'ru', confidence: null, model: 'fake' }),
    });

    expect(await translateOne(TITLE, 'ru', deps)).toEqual({ status: 'skipped' });
    expect(store.size).toBe(0);
  });

  it('turns a provider failure into ProviderFailedError', async () => {
    const { deps } = setup({ rows: visiblePost, translate: () => Promise.reject(new Error('quota')) });

    await expect(translateOne(TITLE, 'en', deps)).rejects.toBeInstanceOf(ProviderFailedError);
  });
});

describe('translateBatch', () => {
  const DESCRIPTION = { ...TITLE, field: 'description' };

  it('reads each table once and the cache once, and matches every row to its own field', async () => {
    const { deps, sourceReads, cacheReads, providerCalls } = setup({
      rows: { ...visiblePost, post_comments: [{ id: COMMENT_ID, body: HEBREW_TITLE }] },
      cached: [
        cachedRow({ translatedText: 'Blue sofa' }),
        cachedRow({ field: 'description', translatedText: 'Almost new' }),
        cachedRow({ contentType: 'comment', contentId: COMMENT_ID, field: 'body', translatedText: 'A blue sofa' }),
      ],
    });

    const results = await translateBatch([TITLE, DESCRIPTION, { contentType: 'comment', contentId: COMMENT_ID, field: 'body' }], 'en', deps);

    expect(sourceReads).toEqual([
      { table: 'posts', key: 'id', columns: ['id', 'title', 'description'], ids: [POST_ID] },
      { table: 'post_comments', key: 'id', columns: ['id', 'body'], ids: [COMMENT_ID] },
    ]);
    expect(cacheReads).toEqual([{ targetLanguage: 'en', ids: [POST_ID, COMMENT_ID] }]);
    expect(results.map((result) => [result.status, result.translation?.translatedText])).toEqual([
      ['cached', 'Blue sofa'],
      ['cached', 'Almost new'],
      ['cached', 'A blue sofa'],
    ]);
    expect(providerCalls).toEqual([]);
  });

  it('skips items outside the registry or not visible to the caller, without reading the cache for them', async () => {
    const { deps, sourceReads, cacheReads } = setup({ rows: { posts: [] } });

    const results = await translateBatch(
      [
        { contentType: 'ride_listing', contentId: POST_ID, field: 'title' }, // retired: rides are posts
        { contentType: 'post', contentId: POST_ID, field: 'display_name' }, // not a translatable field
        TITLE, // row not visible to the caller
      ],
      'en',
      deps,
    );

    expect(results.map((result) => result.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(sourceReads.map((read) => read.table)).toEqual(['posts']);
    expect(cacheReads).toEqual([{ targetLanguage: 'en', ids: [] }]);
  });

  it('translates the misses, stores them, and names each answer after its item', async () => {
    const { deps, store, providerCalls } = setup({
      rows: visiblePost,
      cached: [cachedRow({ translatedText: 'Blue sofa' })],
      translate: (input) => Promise.resolve({ translatedText: `EN(${input.text})`, detectedSourceLanguage: 'he', confidence: null, model: 'fake' }),
    });

    const results = await translateBatch([TITLE, DESCRIPTION], 'en', deps);

    expect(providerCalls).toEqual([{ text: 'כמעט חדשה', targetLanguage: 'en' }]);
    expect(results[1]).toEqual({
      ...DESCRIPTION,
      status: 'translated',
      translation: { ...DESCRIPTION, targetLanguage: 'en', sourceLanguage: 'he', translatedText: 'EN(כמעט חדשה)', model: 'fake', confidence: null },
    });
    expect(store.size).toBe(2);
  });

  it('answers `error` for an item the provider failed on and still answers the others', async () => {
    const { deps, warnings } = setup({
      rows: visiblePost,
      translate: (input) =>
        input.text === HEBREW_TITLE ? Promise.reject(new Error('quota')) : Promise.resolve({ translatedText: 'Almost new', detectedSourceLanguage: 'he', confidence: null, model: 'fake' }),
    });

    const results = await translateBatch([TITLE, DESCRIPTION], 'en', deps);

    expect(results.map((result) => result.status)).toEqual(['error', 'translated']);
    expect(warnings).toEqual(['translation provider failed']);
  });

  it('skips a text the provider returned unchanged and stores nothing for it', async () => {
    const { deps, store } = setup({
      rows: visiblePost,
      translate: (input) => Promise.resolve({ translatedText: ` ${input.text} `, detectedSourceLanguage: null, confidence: null, model: 'fake' }),
    });

    expect((await translateBatch([TITLE], 'en', deps)).map((result) => result.status)).toEqual(['skipped']);
    expect(store.size).toBe(0);
  });

  it('survives a cache that cannot be read or written: the reader still gets the translation', async () => {
    const { deps, warnings } = setup({ rows: visiblePost, failing: new Set(['getMany', 'putIfAbsent'] as const) });

    const results = await translateBatch([TITLE], 'en', deps);

    expect(results[0]).toMatchObject({ status: 'translated', translation: { translatedText: 'Blue sofa' } });
    expect(warnings).toEqual(['translation cache read failed', 'translation cache write failed']);
  });

  it('skips the items of a table that cannot be read and translates the rest', async () => {
    const { deps, warnings } = setup({
      rows: { ...visiblePost, post_comments: [{ id: COMMENT_ID, body: HEBREW_TITLE }] },
      unreadable: new Set(['post_comments']),
    });

    const results = await translateBatch([{ contentType: 'comment', contentId: COMMENT_ID, field: 'body' }, TITLE], 'en', deps);

    expect(results.map((result) => result.status)).toEqual(['skipped', 'translated']);
    expect(warnings).toEqual(['translation source read failed']);
  });
});
