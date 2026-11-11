import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorldSubcategory } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type SubcategoryRow = Pick<
  Database['public']['Tables']['item_subcategories']['Row'],
  'id' | 'slug' | 'label_he' | 'label_en'
>;

/** A subcategory row → the picker's option. */
export function mapWorldSubcategory(row: SubcategoryRow): WorldSubcategory {
  return {
    categoryId: row.id,
    slug: row.slug,
    labelHe: row.label_he,
    labelEn: row.label_en,
  };
}

/**
 * Active item subcategories of a giving world (KC#1296), in display order. The baseline catalog is
 * a tree whose seeded rows are flat, so every active row of the world is an option. A missing
 * catalog surfaces as `BackendUnavailableError`; the picker is optional for most worlds.
 */
export async function listWorldSubcategories(
  client: SupabaseClient<Database>,
  worldSlug: string,
): Promise<WorldSubcategory[]> {
  const rows = unwrapCall(
    'table:item_subcategories',
    await client
      .from('item_subcategories')
      .select('id, slug, label_he, label_en')
      .eq('world_slug', worldSlug)
      .eq('is_active', true)
      .order('sort_order'),
  );
  return (rows ?? []).map(mapWorldSubcategory);
}
