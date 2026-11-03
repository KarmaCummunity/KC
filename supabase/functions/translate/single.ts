// Single-item translate path (FR-TRANSLATE-002 Phase 1b), JWT + RLS visibility.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { isTranslatable, needsTranslation, sameLanguageSkip } from '../_shared/translation/shortcircuit.ts';
import { selectProvider } from '../_shared/translation/provider.ts';
import { resolveField, SOURCE } from '../_shared/translation/kcSource.ts';
import { deleteCached, getCached, putIfAbsent, type CacheKey, type CacheRow } from './cache.ts';

const MAX_INPUT = 5000;

export interface SingleBody {
  contentType: string;
  contentId: string;
  field: string;
  targetLanguage: string;
  sourceText: string;
}

export function isValidSingle(b: unknown): b is SingleBody {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (typeof o.contentType !== 'string' || !SOURCE[o.contentType]) return false;
  if (typeof o.contentId !== 'string' || !o.contentId) return false;
  if (typeof o.field !== 'string' || !resolveField(SOURCE[o.contentType], o.field)) return false;
  if (typeof o.targetLanguage !== 'string' || !o.targetLanguage) return false;
  if (typeof o.sourceText !== 'string' || o.sourceText.length === 0) return false;
  if (o.sourceText.length > MAX_INPUT) return false;
  return true;
}

function isUsableCache(text: string, target: string, cached: CacheRow): boolean {
  const out = (cached.translatedText || '').trim();
  if (!out || out === text.trim()) return false;
  if (cached.sourceLanguage && !needsTranslation(cached.sourceLanguage, target)) return false;
  return true;
}

export async function translateSingle(
  userClient: SupabaseClient,
  writeClient: SupabaseClient,
  body: SingleBody,
): Promise<{ status: 'translated' | 'cached' | 'skipped'; translation?: CacheRow }> {
  const src = SOURCE[body.contentType];
  const resolved = resolveField(src, body.field);
  if (!resolved) return { status: 'skipped' };

  const column = resolved.column;
  const { data: srcRow, error: visErr } = await userClient
    .from(src.table)
    .select(`${src.pk}, ${column}`)
    .eq(src.pk, body.contentId)
    .maybeSingle();
  if (visErr) throw new Error(`visibility: ${visErr.message}`);
  if (!srcRow) throw new Error('forbidden');

  const sourceText = (srcRow as unknown as Record<string, unknown>)[column];
  if (typeof sourceText !== 'string' || sourceText.trim().length === 0) {
    return { status: 'skipped' };
  }
  if (sourceText.length > MAX_INPUT || !isTranslatable(sourceText)) {
    return { status: 'skipped' };
  }
  if (sameLanguageSkip(sourceText, body.targetLanguage)) {
    return { status: 'skipped' };
  }

  const key: CacheKey = {
    contentType: body.contentType,
    contentId: body.contentId,
    field: body.field,
    targetLanguage: body.targetLanguage,
  };

  const cached = await getCached(writeClient, key);
  if (cached && isUsableCache(sourceText, body.targetLanguage, cached)) {
    return { status: 'cached', translation: cached };
  }
  if (cached) await deleteCached(writeClient, key);

  let result;
  try {
    result = await selectProvider().translate({
      text: sourceText,
      targetLanguage: body.targetLanguage,
    });
  } catch (_e) {
    throw new Error('provider_failed');
  }

  if (!needsTranslation(result.detectedSourceLanguage, body.targetLanguage)) {
    return { status: 'skipped' };
  }

  const row: CacheRow = {
    ...key,
    sourceLanguage: result.detectedSourceLanguage,
    translatedText: result.translatedText,
    model: result.model,
    confidence: result.confidence,
  };
  const inserted = await putIfAbsent(writeClient, row);
  const translation = inserted ? row : (await getCached(writeClient, key)) ?? row;
  return { status: inserted ? 'translated' : 'cached', translation };
}
