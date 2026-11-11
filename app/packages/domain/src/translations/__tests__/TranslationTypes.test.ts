import { describe, it, expect } from 'vitest';
import { isContentType, isTranslationField, CONTENT_TYPES, TRANSLATION_FIELDS } from '../TranslationTypes';
import { TranslationError } from '../TranslationError';
import { DomainError } from '../../errors';

describe('TranslationTypes guards', () => {
  it('accepts only known content types', () => {
    expect(isContentType('post')).toBe(true);
    expect(isContentType('message')).toBe(true);
    expect(isContentType('comment')).toBe(true);
    expect(isContentType('user')).toBe(true);
    expect(isContentType('ride_listing')).toBe(false); // rides are posts
    expect(isContentType('listing')).toBe(false);
    expect(isContentType('')).toBe(false);
  });

  it('accepts only known fields', () => {
    expect(isTranslationField('title')).toBe(true);
    expect(isTranslationField('description')).toBe(true);
    expect(isTranslationField('body')).toBe(true);
    expect(isTranslationField('caption')).toBe(false);
  });

  it('exposes the canonical lists', () => {
    expect([...CONTENT_TYPES]).toEqual(['post', 'comment', 'message', 'user']);
    expect([...TRANSLATION_FIELDS]).toEqual(['title', 'description', 'body', 'biography']);
  });
});

describe('TranslationError', () => {
  it('is a DomainError with code "translation"', () => {
    const err = new TranslationError('boom');
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('translation');
    expect(err.message).toBe('boom');
  });
});
