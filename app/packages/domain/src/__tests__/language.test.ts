import { describe, it, expect } from 'vitest';
import { createLanguageTag, resolvePreferredLanguage } from '../language';
import { ValidationError } from '../errors';

describe('createLanguageTag', () => {
  it('accepts and lowercases a plain language subtag', () => {
    expect(createLanguageTag('HE')).toBe('he');
    expect(createLanguageTag('en')).toBe('en');
  });

  it('normalizes script (Title) and region (UPPER) casing', () => {
    expect(createLanguageTag('zh-hant')).toBe('zh-Hant');
    expect(createLanguageTag('pt-br')).toBe('pt-BR');
    expect(createLanguageTag('ZH-HANT-hk')).toBe('zh-Hant-HK');
  });

  it('accepts a UN M.49 numeric region', () => {
    expect(createLanguageTag('es-419')).toBe('es-419');
  });

  it('trims surrounding whitespace', () => {
    expect(createLanguageTag('  fr-CA  ')).toBe('fr-CA');
  });

  it('throws ValidationError(field=languageTag) on empty input', () => {
    let captured: ValidationError | undefined;
    try { createLanguageTag(''); } catch (e) { captured = e as ValidationError; }
    expect(captured).toBeInstanceOf(ValidationError);
    expect(captured?.field).toBe('languageTag');

    expect(() => createLanguageTag(null as unknown as string)).toThrow(ValidationError);
  });

  it('throws ValidationError on malformed tags', () => {
    expect(() => createLanguageTag('e')).toThrow(ValidationError);
    expect(() => createLanguageTag('english')).toThrow(ValidationError);
    expect(() => createLanguageTag('he_IL')).toThrow(ValidationError);
    expect(() => createLanguageTag('123')).toThrow(ValidationError);
  });
});

describe('resolvePreferredLanguage', () => {
  it('prefers a valid explicit user preference', () => {
    const out = resolvePreferredLanguage({
      userPreference: 'en', deviceLocales: ['fr-FR'], fallback: 'he',
    });
    expect(out).toBe('en');
  });

  it('falls back to the first valid device locale when no user preference', () => {
    const out = resolvePreferredLanguage({
      userPreference: null, deviceLocales: ['not valid', 'pt-br'], fallback: 'he',
    });
    expect(out).toBe('pt-BR');
  });

  it('uses fallback when preference and all device locales are invalid/empty', () => {
    const out = resolvePreferredLanguage({
      userPreference: '   ', deviceLocales: [], fallback: 'he',
    });
    expect(out).toBe('he');
  });

  it('ignores an invalid user preference and uses device locale', () => {
    const out = resolvePreferredLanguage({
      userPreference: 'english', deviceLocales: ['ar'], fallback: 'he',
    });
    expect(out).toBe('ar');
  });

  it('handles undefined deviceLocales gracefully', () => {
    const out = resolvePreferredLanguage({
      userPreference: null,
      fallback: 'en',
    });
    expect(out).toBe('en');
  });
});
