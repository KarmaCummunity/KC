import { ValidationError } from '../errors';
import { createLanguageTag, type LanguageTag } from '../language';
import { isContentType, isTranslationField, type ContentType, type TranslationField } from './TranslationTypes';

export interface TranslationRequest {
  readonly contentType: ContentType;
  readonly contentId: string;
  readonly field: TranslationField;
  readonly sourceLanguage: LanguageTag | null;
  readonly targetLanguage: LanguageTag;
}

// Posts carry title/description; comments and messages carry body; users carry biography.
const FIELDS_BY_TYPE: Record<ContentType, readonly TranslationField[]> = {
  post: ['title', 'description'],
  comment: ['body'],
  message: ['body'],
  user: ['biography'],
};

export function createTranslationRequest(input: {
  contentType: string;
  contentId: string;
  field: string;
  sourceLanguage: string | null;
  targetLanguage: string;
}): TranslationRequest {
  if (!isContentType(input.contentType)) {
    throw new ValidationError(`TranslationRequest: unknown content type '${input.contentType}'`, 'contentType');
  }
  if (!isTranslationField(input.field) || !FIELDS_BY_TYPE[input.contentType].includes(input.field)) {
    throw new ValidationError(`TranslationRequest: field '${input.field}' invalid for ${input.contentType}`, 'field');
  }
  if (!input.contentId) {
    throw new ValidationError('TranslationRequest: contentId is required', 'contentId');
  }
  return {
    contentType: input.contentType,
    contentId: input.contentId,
    field: input.field,
    sourceLanguage: input.sourceLanguage ? createLanguageTag(input.sourceLanguage) : null,
    targetLanguage: createLanguageTag(input.targetLanguage),
  };
}
