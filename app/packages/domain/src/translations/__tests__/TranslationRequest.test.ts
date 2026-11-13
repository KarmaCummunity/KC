import { describe, it, expect } from 'vitest';
import { createTranslationRequest } from '../TranslationRequest';
import { ValidationError } from '../../errors';

describe('createTranslationRequest', () => {
  it('builds a normalized request', () => {
    const req = createTranslationRequest({
      contentType: 'post', contentId: '11111111-1111-1111-1111-111111111111',
      field: 'title', sourceLanguage: 'HE', targetLanguage: 'pt-br',
    });
    expect(req.contentType).toBe('post');
    expect(req.field).toBe('title');
    expect(req.sourceLanguage).toBe('he');       // normalized LanguageTag
    expect(req.targetLanguage).toBe('pt-BR');
  });

  it('allows a null/unknown source language', () => {
    const req = createTranslationRequest({
      contentType: 'message', contentId: '11111111-1111-1111-1111-111111111111',
      field: 'body', sourceLanguage: null, targetLanguage: 'en',
    });
    expect(req.sourceLanguage).toBeNull();
  });

  it('rejects an unknown content type (ride_listing is retired: rides are posts)', () => {
    expect(() => createTranslationRequest({
      contentType: 'ride_listing' as never, contentId: '11111111-1111-1111-1111-111111111111',
      field: 'body', sourceLanguage: null, targetLanguage: 'en',
    })).toThrow(ValidationError);
  });

  it('rejects a field not valid for the content type (message must use body)', () => {
    expect(() => createTranslationRequest({
      contentType: 'message', contentId: '11111111-1111-1111-1111-111111111111',
      field: 'title', sourceLanguage: null, targetLanguage: 'en',
    })).toThrow(ValidationError);
  });

  it('rejects an invalid target language', () => {
    expect(() => createTranslationRequest({
      contentType: 'post', contentId: '11111111-1111-1111-1111-111111111111',
      field: 'title', sourceLanguage: null, targetLanguage: 'english',
    })).toThrow(ValidationError);
  });

  it('rejects empty contentId', () => {
    expect(() => createTranslationRequest({
      contentType: 'post', contentId: '',
      field: 'title', sourceLanguage: null, targetLanguage: 'en',
    })).toThrow(ValidationError);
  });

  it('rejects a field that is completely invalid as a translation field', () => {
    expect(() => createTranslationRequest({
      contentType: 'post', contentId: '11111111-1111-1111-1111-111111111111',
      field: 'unsupported_field', sourceLanguage: null, targetLanguage: 'en',
    })).toThrow(ValidationError);
  });

  it('accepts comment and user content types with their fields', () => {
    const commentReq = createTranslationRequest({
      contentType: 'comment', contentId: '11111111-1111-1111-1111-111111111111',
      field: 'body', sourceLanguage: null, targetLanguage: 'en',
    });
    expect(commentReq.contentType).toBe('comment');
    expect(commentReq.field).toBe('body');

    const userReq = createTranslationRequest({
      contentType: 'user', contentId: '11111111-1111-1111-1111-111111111111',
      field: 'biography', sourceLanguage: null, targetLanguage: 'en',
    });
    expect(userReq.contentType).toBe('user');
    expect(userReq.field).toBe('biography');
  });

  it('rejects a comment field other than body', () => {
    expect(() => createTranslationRequest({
      contentType: 'comment', contentId: '11111111-1111-1111-1111-111111111111',
      field: 'title', sourceLanguage: null, targetLanguage: 'en',
    })).toThrow(ValidationError);
  });
});
