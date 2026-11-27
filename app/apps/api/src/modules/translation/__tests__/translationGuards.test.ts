import { describe, expect, it } from 'vitest';
import { resolveSource, TRANSLATABLE_SOURCES } from '../translatableSources';
import { parseTranslateRequest } from '../translateRequest';
import { isSupportedTarget, isTranslatable, isUsableCachedTranslation, MAX_SOURCE_LENGTH, sameLanguageSkip } from '../translationGuards';

describe('translatable sources', () => {
  it('follow the cache table: its content types, each row keyed by id, and no retired ride listing', () => {
    expect(Object.fromEntries(Object.entries(TRANSLATABLE_SOURCES).map(([type, source]) => [type, [source.table, source.key]]))).toEqual({
      post: ['posts', 'id'],
      comment: ['post_comments', 'id'],
      message: ['messages', 'id'],
      user: ['users', 'id'],
    });
  });

  it('resolve every documented field to its column', () => {
    expect(resolveSource('post', 'title')).toEqual({ table: 'posts', key: 'id', column: 'title' });
    expect(resolveSource('post', 'description')).toEqual({ table: 'posts', key: 'id', column: 'description' });
    expect(resolveSource('comment', 'body')).toEqual({ table: 'post_comments', key: 'id', column: 'body' });
    expect(resolveSource('message', 'body')).toEqual({ table: 'messages', key: 'id', column: 'body' });
    expect(resolveSource('user', 'biography')).toEqual({ table: 'users', key: 'id', column: 'biography' });
  });

  it('refuse proper names, unknown fields, unknown types and names inherited from Object', () => {
    for (const [type, field] of [
      ['post', 'display_name'],
      ['user', 'display_name'],
      ['comment', 'author_id'],
      ['ride_listing', 'title'],
      ['constructor', 'title'],
      ['post', 'toString'],
    ] as const) {
      expect(resolveSource(type, field), `${type}.${field}`).toBeNull();
    }
  });
});

describe('translation guards', () => {
  it('accept the offered target languages by base tag and nothing else', () => {
    expect(['he', 'en', 'en-US', 'AR', 'ru', 'am'].map(isSupportedTarget)).toEqual([true, true, true, true, true, true]);
    expect(['fr', 'zh-Hant', '', 'english'].map(isSupportedTarget)).toEqual([false, false, false, false]);
  });

  it('do not send text that is not language: empty, emoji, one address, numbers', () => {
    expect(['', '   ', '🎉 🎉', 'https://kc.test/p/1', '12:30', '50%', '1,200.50'].map(isTranslatable)).toEqual(Array(7).fill(false));
    expect(['ספה כחולה', 'Blue sofa', 'see https://kc.test/p/1', '3 chairs'].map(isTranslatable)).toEqual(Array(4).fill(true));
  });

  it('skip text already in the reader\'s script, for Hebrew and English readers only', () => {
    expect(sameLanguageSkip('ספה כחולה', 'he')).toBe(true);
    expect(sameLanguageSkip('Blue sofa', 'he')).toBe(false);
    expect(sameLanguageSkip('Blue sofa', 'en')).toBe(true);
    expect(sameLanguageSkip('ספה blue', 'en')).toBe(false);
    // No script rule for other readers: the provider decides.
    expect(sameLanguageSkip('Синий диван', 'ru')).toBe(false);
    expect(sameLanguageSkip('   ', 'he')).toBe(false);
  });

  it('serve a cached translation only when it says something the source does not', () => {
    const cached = (translatedText: string, sourceLanguage: string | null) => ({ translatedText, sourceLanguage });

    expect(isUsableCachedTranslation('ספה', 'en', cached('Sofa', 'he'))).toBe(true);
    expect(isUsableCachedTranslation('ספה', 'en', cached('Sofa', null))).toBe(true);
    expect(isUsableCachedTranslation('ספה', 'en', cached('  ', 'he'))).toBe(false);
    expect(isUsableCachedTranslation('Sofa', 'en', cached(' Sofa ', 'he'))).toBe(false);
    // A row that claims to translate English into English.
    expect(isUsableCachedTranslation('Sofa', 'en', cached('Couch', 'en-GB'))).toBe(false);
  });
});

describe('parseTranslateRequest', () => {
  const single = { contentType: 'post', contentId: 'p1', field: 'title', targetLanguage: 'en', sourceText: 'ספה' };

  it('reads a single request and drops the client\'s text: the server reads its own', () => {
    expect(parseTranslateRequest(single)).toEqual({ kind: 'single', targetLanguage: 'en', item: { contentType: 'post', contentId: 'p1', field: 'title' } });
  });

  it('reads a batch, keeping only well-formed items', () => {
    const body = { targetLanguage: 'en', items: [{ contentType: 'post', contentId: 'p1', field: 'title', extra: 1 }, { contentType: 'post' }, null] };

    expect(parseTranslateRequest(body)).toEqual({ kind: 'batch', targetLanguage: 'en', items: [{ contentType: 'post', contentId: 'p1', field: 'title' }] });
  });

  it.each([
    ['not an object', 'text'],
    ['without a target language', { ...single, targetLanguage: '' }],
    ['a batch with no usable item', { targetLanguage: 'en', items: [{}] }],
    ['a single of an unknown content type', { ...single, contentType: 'ride_listing' }],
    ['a single of a field that is not translatable', { ...single, field: 'display_name' }],
    ['a single without the source text', { ...single, sourceText: '' }],
    ['a single whose source text is too long', { ...single, sourceText: 'x'.repeat(MAX_SOURCE_LENGTH + 1) }],
  ])('rejects %s', (_label, body) => {
    expect(parseTranslateRequest(body)).toBeNull();
  });
});
