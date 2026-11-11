import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExternalBodyOption } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type OrganizationRow = Pick<Database['public']['Tables']['organizations']['Row'], 'id' | 'slug' | 'name' | 'website_url'>;

/** An organization row → the option of a routed world's body picker. */
export function mapExternalBody(row: OrganizationRow, worldSlug: string): ExternalBodyOption {
  return {
    bodyId: row.id,
    slug: row.slug,
    worldSlug,
    labelHe: row.name,
    labelEn: row.name,
    bodyType: 'organization',
    contactUrl: row.website_url,
  };
}

/** Escapes the characters a `like` pattern treats as wildcards, so the member's text matches literally. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Organizations a routed world's listing can be handed to (FR-ORG-001): external bodies are
 * organizations, so the list is the organizations the caller may read (policy
 * `organizations_select_active`) whose name contains `query`, by name. The world only labels the
 * options; the baseline does not tie an organization to a world.
 */
export async function searchExternalBodies(
  client: SupabaseClient<Database>,
  worldSlug: string,
  query?: string | null,
  limit = 50,
): Promise<ExternalBodyOption[]> {
  let request = client.from('organizations').select('id, slug, name, website_url').order('name').limit(limit);
  const text = query?.trim() ?? '';
  if (text.length > 0) request = request.ilike('name', `%${likeLiteral(text)}%`);
  const rows = unwrapCall('table:organizations', await request);
  return (rows ?? []).map((row) => mapExternalBody(row, worldSlug));
}
