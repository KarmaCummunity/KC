// supabase/functions/_shared/post-extraction/lists.ts
// The closed lists the model must choose from (FR-IMPORT-003 AC1), read from the live catalog
// so a new world or sub-category needs no code change.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import type { ExtractionLists } from './domain/validateExtraction.ts';

/** Worlds a member can publish into; the other worlds are portals and are never extracted into. */
export const PUBLISHABLE_WORLDS: readonly string[] = ['items', 'food', 'rides', 'time', 'housing', 'animals', 'knowledge'];
const LISTS_TTL_MS = 5 * 60 * 1000;

interface Rows<T> { data: T[] | null; error: { message: string } | null }

async function rows<T>(query: PromiseLike<Rows<T>>, what: string): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`extraction lists (${what}): ${error.message}`);
  return data ?? [];
}

/** The JSON Schema property names of a post kind: the detail keys its form accepts. */
function detailKeysOf(schema: unknown): string[] {
  const properties = (schema as { properties?: Record<string, unknown> } | null)?.properties;
  return properties && typeof properties === 'object' ? Object.keys(properties) : [];
}

export async function loadExtractionLists(client: SupabaseClient): Promise<ExtractionLists> {
  const [worlds, subs, kinds] = await Promise.all([
    rows<{ slug: string }>(client.from('worlds').select('slug').eq('is_active', true), 'worlds'),
    rows<{ world_slug: string; slug: string }>(
      client.from('item_subcategories').select('world_slug, slug').eq('is_active', true), 'sub-categories'),
    rows<{ world_slug: string; detail_schema: unknown }>(
      client.from('post_kinds').select('world_slug, detail_schema').eq('is_active', true), 'kinds'),
  ]);
  const active = new Set(worlds.map((w) => w.slug));
  const slugs = PUBLISHABLE_WORLDS.filter((w) => active.has(w));
  const subcategories: Record<string, string[]> = {};
  for (const s of subs) if (slugs.includes(s.world_slug)) (subcategories[s.world_slug] ??= []).push(s.slug);
  const detailKeys: Record<string, string[]> = {};
  for (const k of kinds) {
    if (!slugs.includes(k.world_slug)) continue;
    detailKeys[k.world_slug] = [...new Set([...(detailKeys[k.world_slug] ?? []), ...detailKeysOf(k.detail_schema)])];
  }
  return { worlds: slugs, subcategories, detailKeys };
}

/** Memoizes the lists for a few minutes: they change with a migration, not per request. */
export function cachedLists(load: () => Promise<ExtractionLists>, now: () => Date = () => new Date()): () => Promise<ExtractionLists> {
  let held: { at: number; lists: ExtractionLists } | null = null;
  return async () => {
    const t = now().getTime();
    if (held && t - held.at < LISTS_TTL_MS) return held.lists;
    held = { at: t, lists: await load() };
    return held.lists;
  };
}
