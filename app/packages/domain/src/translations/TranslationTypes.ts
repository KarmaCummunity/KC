// Content/field taxonomy for UGC translation (FR-TRANSLATE-002). Equal to the
// content_type check of public.content_translations and the source registry of
// the `translate` Edge Function. Rides are posts, so there is no ride type.

export const CONTENT_TYPES = ['post', 'comment', 'message', 'user'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const TRANSLATION_FIELDS = ['title', 'description', 'body', 'biography'] as const;
export type TranslationField = (typeof TRANSLATION_FIELDS)[number];

export function isContentType(v: unknown): v is ContentType {
  return typeof v === 'string' && (CONTENT_TYPES as readonly string[]).includes(v);
}

export function isTranslationField(v: unknown): v is TranslationField {
  return typeof v === 'string' && (TRANSLATION_FIELDS as readonly string[]).includes(v);
}
