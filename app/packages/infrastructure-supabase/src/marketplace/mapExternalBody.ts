import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExternalBodyOption } from '@kc/domain';
import type { Database } from '../database.legacy.types';

export type ExternalBodyRow = Database['public']['Functions']['search_external_bodies']['Returns'][number];

export function mapExternalBody(row: ExternalBodyRow): ExternalBodyOption {
  return {
    bodyId: row.body_id,
    slug: row.slug,
    worldSlug: row.world_slug,
    labelHe: row.label_he,
    labelEn: row.label_en,
    bodyType: row.body_type,
    contactUrl: row.contact_url ?? null,
  };
}

/** search_external_bodies (0353), split out of SupabaseMarketplaceRepository (300-line cap). */
export async function searchExternalBodies(
  client: SupabaseClient<Database>,
  worldSlug: string,
  query?: string | null,
  limit = 50,
): Promise<ExternalBodyOption[]> {
  const { data, error } = await client.rpc('search_external_bodies', {
    p_world_slug: worldSlug,
    p_query: query ?? undefined,
    p_limit: limit,
  });
  if (error || !data) return [];
  return data.map(mapExternalBody);
}
