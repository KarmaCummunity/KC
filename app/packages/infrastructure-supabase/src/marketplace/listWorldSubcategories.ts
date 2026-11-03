import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorldSubcategory } from '@kc/domain';
import type { Database } from '../database.types';

type CategoryRow = Pick<
  Database['public']['Tables']['categories']['Row'],
  'category_id' | 'slug' | 'label_he' | 'label_en'
>;

export function mapWorldSubcategory(row: CategoryRow): WorldSubcategory {
  return {
    categoryId: row.category_id,
    slug: row.slug,
    labelHe: row.label_he,
    labelEn: row.label_en,
  };
}

/**
 * Active child categories of a giving world (KC#1296), split out of SupabaseMarketplaceRepository
 * (300-line cap). The world's root row (no parent) is not a subcategory, so it is left out.
 * Returns [] on error: the picker is optional and a listing can be published without one.
 */
export async function listWorldSubcategories(
  client: SupabaseClient<Database>,
  worldSlug: string,
): Promise<WorldSubcategory[]> {
  const { data, error } = await client
    .from('categories')
    .select('category_id, slug, label_he, label_en')
    .eq('world_slug', worldSlug)
    .eq('is_active', true)
    .not('parent_id', 'is', null)
    .order('sort_order');
  if (error || !data) return [];
  return data.map(mapWorldSubcategory);
}
