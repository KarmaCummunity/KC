// Where each translatable text lives (FR-TRANSLATE-002 / 006): one entry per
// `content_type` of `public.content_translations`, with the fields its check
// constraint allows. Rides are posts, so there is no separate ride entry.
//
// Anti-poisoning: the text to translate is always read again from these rows
// on the server, never taken from the request. Proper names (display name,
// share handle) are deliberately absent.

import type { ContentType, TranslationField } from '@kc/domain';

export interface TranslatableSource {
  readonly table: string;
  /** The key column a `contentId` is matched against. */
  readonly key: string;
  /** Translation field → the column that holds its text. */
  readonly fields: Readonly<Partial<Record<TranslationField, string>>>;
}

export const TRANSLATABLE_SOURCES: Readonly<Record<ContentType, TranslatableSource>> = {
  post: { table: 'posts', key: 'id', fields: { title: 'title', description: 'description' } },
  comment: { table: 'post_comments', key: 'id', fields: { body: 'body' } },
  message: { table: 'messages', key: 'id', fields: { body: 'body' } },
  user: { table: 'users', key: 'id', fields: { biography: 'biography' } },
};

/** One text the server can translate: the row's table and key, and the column of the field. */
export interface ResolvedSource {
  readonly table: string;
  readonly key: string;
  readonly column: string;
}

/**
 * Looks up where `field` of a `contentType` is stored.
 * @returns null for a content type or a field outside the registry (`Object.hasOwn`, so
 *   `constructor` or `toString` from a request can never name one).
 */
export function resolveSource(contentType: string, field: string): ResolvedSource | null {
  if (!Object.hasOwn(TRANSLATABLE_SOURCES, contentType)) return null;
  const source = TRANSLATABLE_SOURCES[contentType as ContentType];
  if (!Object.hasOwn(source.fields, field)) return null;
  return { table: source.table, key: source.key, column: source.fields[field as TranslationField] as string };
}
