// Batch resolution for KC UGC translation (FR-TRANSLATE-006).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { isTranslatable, needsTranslation, sameLanguageSkip } from '../_shared/translation/shortcircuit.ts';
import { selectProvider } from '../_shared/translation/provider.ts';
import { translateMany } from '../_shared/translation/batch.ts';
import { resolveField, SOURCE } from '../_shared/translation/kcSource.ts';
import { deleteCached, getCached, putIfAbsent, type CacheRow } from './cache.ts';

const MAX_INPUT = 5000;
const PROVIDER_CONCURRENCY = 2;

export interface TranslateItem {
  contentType: string;
  contentId: string;
  field: string;
}

export type TranslateStatus = 'translated' | 'cached' | 'skipped' | 'error';

export interface TranslateResult {
  contentType: string;
  contentId: string;
  field: string;
  status: TranslateStatus;
  translation?: CacheRow;
}

function isAllowed(it: TranslateItem): boolean {
  const src = SOURCE[it.contentType];
  return !!src && !!resolveField(src, it.field);
}

async function readSources(
  readClient: SupabaseClient,
  items: TranslateItem[],
): Promise<Record<string, Record<string, unknown>>> {
  const byTable: Record<string, { pk: string; ids: Set<string>; cols: Set<string> }> = {};
  for (const it of items) {
    const src = SOURCE[it.contentType];
    const r = resolveField(src, it.field);
    if (!r) continue;
    const g = byTable[src.table] ?? (byTable[src.table] = { pk: src.pk, ids: new Set(), cols: new Set() });
    g.ids.add(it.contentId);
    g.cols.add(r.column);
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const [table, g] of Object.entries(byTable)) {
    const select = [g.pk, ...g.cols].join(', ');
    const { data, error } = await readClient.from(table).select(select).in(g.pk, Array.from(g.ids));
    if (error) {
      console.warn('[translate] source read failed', { table, detail: error.message });
      continue;
    }
    if (!data) continue;
    for (const row of data as unknown as Record<string, unknown>[]) {
      out[`${table}:${row[g.pk]}`] = row;
    }
  }
  return out;
}

function sourceTextFor(it: TranslateItem, rows: Record<string, Record<string, unknown>>): string | null {
  const src = SOURCE[it.contentType];
  const r = resolveField(src, it.field);
  if (!r) return null;
  const row = rows[`${src.table}:${it.contentId}`];
  if (!row) return null;
  const raw = row[r.column];
  const val = r.index === null ? raw : (Array.isArray(raw) ? raw[r.index] : undefined);
  if (typeof val !== 'string') return null;
  const t = val.trim();
  if (!t || t.length > MAX_INPUT || !isTranslatable(t)) return null;
  return val;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function skipped(it: TranslateItem): TranslateResult {
  return { contentType: it.contentType, contentId: it.contentId, field: it.field, status: 'skipped' };
}

function errored(it: TranslateItem): TranslateResult {
  return { contentType: it.contentType, contentId: it.contentId, field: it.field, status: 'error' };
}

function hit(it: TranslateItem, status: TranslateStatus, translation: CacheRow): TranslateResult {
  return { contentType: it.contentType, contentId: it.contentId, field: it.field, status, translation };
}

function isUsableCache(text: string, target: string, cached: CacheRow): boolean {
  const out = (cached.translatedText || '').trim();
  if (!out || out === text.trim()) return false;
  if (cached.sourceLanguage && !needsTranslation(cached.sourceLanguage, target)) return false;
  return true;
}

export async function resolveBatch(
  readClient: SupabaseClient,
  writeClient: SupabaseClient,
  target: string,
  items: TranslateItem[],
): Promise<TranslateResult[]> {
  const rows = await readSources(readClient, items.filter(isAllowed));
  const results = new Array<TranslateResult>(items.length);
  const misses: { i: number; it: TranslateItem; text: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const text = isAllowed(it) ? sourceTextFor(it, rows) : null;
    if (text === null) {
      results[i] = skipped(it);
      continue;
    }
    const key = {
      contentType: it.contentType,
      contentId: it.contentId,
      field: it.field,
      targetLanguage: target,
    };
    let cached: CacheRow | null = null;
    try {
      cached = await getCached(writeClient, key);
    } catch (e) {
      console.warn('[translate] cache read failed', { field: it.field, detail: errMsg(e) });
    }
    if (sameLanguageSkip(text, target)) {
      results[i] = skipped(it);
      continue;
    }
    if (cached) {
      if (isUsableCache(text, target, cached)) {
        results[i] = hit(it, 'cached', cached);
        continue;
      }
      try {
        await deleteCached(writeClient, key);
      } catch (e) {
        console.warn('[translate] cache delete failed', { field: it.field, detail: errMsg(e) });
      }
    }
    misses.push({ i, it, text });
  }

  const translated = await translateMany(
    selectProvider(),
    misses.map((m) => ({ text: m.text, targetLanguage: target })),
    PROVIDER_CONCURRENCY,
  );

  for (let k = 0; k < misses.length; k++) {
    const { i, it } = misses[k];
    const res = translated[k];
    if (!res) {
      results[i] = errored(it);
      continue;
    }
    if (!needsTranslation(res.detectedSourceLanguage, target)) {
      results[i] = skipped(it);
      continue;
    }
    if ((res.translatedText || '').trim() === misses[k].text.trim()) {
      results[i] = skipped(it);
      continue;
    }
    const key = {
      contentType: it.contentType,
      contentId: it.contentId,
      field: it.field,
      targetLanguage: target,
    };
    const row: CacheRow = {
      ...key,
      sourceLanguage: res.detectedSourceLanguage,
      translatedText: res.translatedText,
      model: res.model,
      confidence: res.confidence,
    };
    try {
      const inserted = await putIfAbsent(writeClient, row);
      results[i] = hit(
        it,
        inserted ? 'translated' : 'cached',
        inserted ? row : (await getCached(writeClient, key)) ?? row,
      );
    } catch (e) {
      console.warn('[translate] cache write failed', { field: it.field, detail: errMsg(e) });
      results[i] = hit(it, 'translated', row);
    }
  }
  return results;
}
