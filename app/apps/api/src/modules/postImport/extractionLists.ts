// The closed lists the model must choose from (FR-IMPORT-003 AC1), read from
// the live catalog, so a new giving world or item subcategory needs no code
// change.
//
// Ported from `supabase/functions/_shared/post-extraction/lists.ts`.

import type { ExtractionLists } from '@kc/domain';
import type { SqlBackedClient } from '../../platform/postgrest/sqlBackedClient';

/** Giving worlds a member can publish into; the other worlds are portals and are never extracted into. */
export const PUBLISHABLE_WORLDS: readonly string[] = ['items', 'food', 'rides', 'time', 'housing', 'animals', 'knowledge'];
/** The lists change with a migration, not per request. */
const LISTS_TTL_MS = 5 * 60 * 1000;

/** The rows of a query, or a rejection that names what was being read. */
async function rowsOf<Row>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`extraction lists (${what}): ${error.message}`);
  return (data ?? []) as Row[];
}

/** The JSON Schema property names of a post kind: the detail keys its form accepts. */
function detailKeysOf(schema: unknown): string[] {
  const properties = (schema as { properties?: Record<string, unknown> } | null)?.properties;
  return properties && typeof properties === 'object' ? Object.keys(properties) : [];
}

/** Reads the active giving worlds, their item subcategories and the detail keys of their post kinds. */
export async function loadExtractionLists(client: SqlBackedClient): Promise<ExtractionLists> {
  const [worlds, subcategoryRows, kinds] = await Promise.all([
    rowsOf<{ slug: string }>(client.from('worlds').select('slug').eq('is_active', true), 'worlds'),
    rowsOf<{ world_slug: string; slug: string }>(client.from('item_subcategories').select('world_slug, slug').eq('is_active', true), 'sub-categories'),
    rowsOf<{ world_slug: string; detail_schema: unknown }>(client.from('post_kinds').select('world_slug, detail_schema').eq('is_active', true), 'kinds'),
  ]);
  const active = new Set(worlds.map((world) => world.slug));
  const publishable = PUBLISHABLE_WORLDS.filter((slug) => active.has(slug));

  const subcategories: Record<string, string[]> = {};
  for (const row of subcategoryRows) {
    if (publishable.includes(row.world_slug)) (subcategories[row.world_slug] ??= []).push(row.slug);
  }
  const detailKeys: Record<string, string[]> = {};
  for (const kind of kinds) {
    if (!publishable.includes(kind.world_slug)) continue;
    // A world can have several kinds; its allowed keys are the union.
    detailKeys[kind.world_slug] = [...new Set([...(detailKeys[kind.world_slug] ?? []), ...detailKeysOf(kind.detail_schema)])];
  }
  return { worlds: publishable, subcategories, detailKeys };
}

/** Keeps the lists for a few minutes. A failed load is not kept: the next call tries again. */
export function cachedLists(load: () => Promise<ExtractionLists>, now: () => Date = () => new Date()): () => Promise<ExtractionLists> {
  let held: { at: number; lists: ExtractionLists } | null = null;
  return async () => {
    const at = now().getTime();
    if (held && at - held.at < LISTS_TTL_MS) return held.lists;
    held = { at, lists: await load() };
    return held.lists;
  };
}
