// The post kinds of every giving world (`post_kinds`), read once per client.
//
// A `post_card` names its kind by id; the marketplace screens speak the kind's slug
// (`ride_offer`, `food_offer`, `event`, ...), the form picks a kind per world and direction, and
// a create call needs the kind id. The catalog is a handful of seeded rows that only a migration
// changes, so one read serves the whole session.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListingKindOption } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type Client = SupabaseClient<Database>;
type KindRow = Pick<
  Database['public']['Tables']['post_kinds']['Row'],
  'id' | 'slug' | 'world_slug' | 'direction' | 'label_he' | 'label_en' | 'detail_schema'
>;

export interface KindCatalog {
  /** Active kinds in display order (`sort_order`). */
  readonly kinds: readonly KindRow[];
  readonly byId: ReadonlyMap<string, KindRow>;
}

const cache = new WeakMap<object, Promise<KindCatalog>>();

async function readCatalog(client: Client): Promise<KindCatalog> {
  const rows = unwrapCall(
    'table:post_kinds',
    await client
      .from('post_kinds')
      .select('id, slug, world_slug, direction, label_he, label_en, detail_schema')
      .eq('is_active', true)
      .order('sort_order'),
  );
  const kinds = rows ?? [];
  return { kinds, byId: new Map(kinds.map((kind) => [kind.id, kind])) };
}

/** The kind catalog; a failed read is not cached, so the next call retries. */
export function loadKindCatalog(client: Client): Promise<KindCatalog> {
  const cached = cache.get(client);
  if (cached) return cached;
  const pending = readCatalog(client);
  cache.set(client, pending);
  pending.catch(() => cache.delete(client));
  return pending;
}

/** The listing vocabulary of a post direction: an offer is a "give". */
export function listingDirectionOf(direction: string | null | undefined): 'give' | 'request' {
  return direction === 'request' ? 'request' : 'give';
}

/** The post direction of the listing vocabulary. */
export function postDirectionOf(direction: 'give' | 'request'): 'offer' | 'request' {
  return direction === 'request' ? 'request' : 'offer';
}

/** The kinds a world's create form may publish, as the form reads them. */
export async function listKindOptions(client: Client, worldSlug: string): Promise<ListingKindOption[]> {
  const catalog = await loadKindCatalog(client);
  return catalog.kinds
    .filter((kind) => kind.world_slug === worldSlug)
    .map((kind) => ({
      kindId: kind.id,
      slug: kind.slug,
      labelEn: kind.label_en,
      labelHe: kind.label_he,
      direction: kind.direction === 'either' ? 'either' : listingDirectionOf(kind.direction),
      detailSchema: (kind.detail_schema as Record<string, unknown> | null) ?? {},
    }));
}
