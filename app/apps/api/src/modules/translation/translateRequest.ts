// The two bodies the app sends to `translate`, and which one a request is.
// Ported from `supabase/functions/translate/index.ts`.

import { resolveSource } from './translatableSources';
import { MAX_SOURCE_LENGTH } from './translationGuards';
import type { TranslationItem } from './translationService';

export type TranslateRequest =
  | { readonly kind: 'batch'; readonly targetLanguage: string; readonly items: readonly TranslationItem[] }
  | { readonly kind: 'single'; readonly targetLanguage: string; readonly item: TranslationItem };

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function isItem(value: unknown): value is TranslationItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return isNonEmptyString(item.contentType) && isNonEmptyString(item.contentId) && isNonEmptyString(item.field);
}

/**
 * Reads a request body.
 * - Batch: `{ targetLanguage, items: [{ contentType, contentId, field }] }`. Malformed items are dropped; none left is invalid.
 * - Single: `{ contentType, contentId, field, targetLanguage, sourceText }`. `sourceText` must be present and within the
 *   length limit, but it is never translated: the server reads the text itself.
 * @returns null for a body that is neither.
 */
export function parseTranslateRequest(body: unknown): TranslateRequest | null {
  if (!body || typeof body !== 'object') return null;
  const fields = body as Record<string, unknown>;
  if (!isNonEmptyString(fields.targetLanguage)) return null;

  if (Array.isArray(fields.items)) {
    const items = fields.items.filter(isItem).map(({ contentType, contentId, field }) => ({ contentType, contentId, field }));
    return items.length > 0 ? { kind: 'batch', targetLanguage: fields.targetLanguage, items } : null;
  }

  if (!isItem(fields) || !resolveSource(fields.contentType, fields.field)) return null;
  if (!isNonEmptyString(fields.sourceText) || fields.sourceText.length > MAX_SOURCE_LENGTH) return null;
  const { contentType, contentId, field } = fields;
  return { kind: 'single', targetLanguage: fields.targetLanguage, item: { contentType, contentId, field } };
}
