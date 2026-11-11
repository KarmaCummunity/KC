// The catalog rows a generic post needs: which item subcategory is a domain `Category`, and which
// post kind is a Give or a Request in the items world.
//
// The baseline stores a post's category as `item_subcategory_id` and its direction as `direction` plus
// a required `kind_id`; both point at configuration rows loaded by the seed scripts (the catalog is
// read-only for a device). The app keeps its `Category` vocabulary, so this module translates in both
// directions. The catalog is tiny and static, so it is read once per client and reused.

import type { SupabaseClient } from '@supabase/supabase-js';
import { BackendUnavailableError, type Category, type PostType } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

/** The giving world that holds generic (item) posts. */
export const ITEMS_WORLD = 'items';

/** `item_subcategories.slug` of every item `Category`. */
export const CATEGORY_SLUG: Readonly<Record<Category, string>> = {
  Furniture: 'furniture',
  Clothing: 'clothing',
  Books: 'books',
  Toys: 'toys',
  BabyGear: 'baby_gear',
  Kitchen: 'kitchen',
  Sports: 'sports',
  Electronics: 'electronics',
  Tools: 'tools',
  Other: 'other',
};

/** `posts.direction` of a domain post type. */
export function directionOf(type: PostType): 'offer' | 'request' {
  return type === 'Give' ? 'offer' : 'request';
}

/** Domain post type of a `posts.direction`. */
export function postTypeOf(direction: string | null | undefined): PostType {
  return direction === 'request' ? 'Request' : 'Give';
}

export interface PostCatalog {
  /** Subcategory id of an item category; absent when the catalog lacks that row. */
  readonly subcategoryIdOf: ReadonlyMap<Category, string>;
  /** Item category of a subcategory id. */
  readonly categoryOf: ReadonlyMap<string, Category>;
  /** Post kind id used for an offer / a request in the items world. */
  readonly kindIdOf: ReadonlyMap<'offer' | 'request', string>;
}

const cache = new WeakMap<object, Promise<PostCatalog>>();

async function readCatalog(client: SupabaseClient<Database>): Promise<PostCatalog> {
  const [subcategories, kinds] = await Promise.all([
    client.from('item_subcategories').select('id, slug').eq('world_slug', ITEMS_WORLD).eq('is_active', true),
    client
      .from('post_kinds')
      .select('id, direction')
      .eq('world_slug', ITEMS_WORLD)
      .eq('is_active', true)
      .order('sort_order'),
  ]);
  const categoryBySlug = new Map((Object.entries(CATEGORY_SLUG) as [Category, string][]).map(([c, s]) => [s, c]));
  const subcategoryIdOf = new Map<Category, string>();
  const categoryOf = new Map<string, Category>();
  for (const row of unwrapCall('table:item_subcategories', subcategories) ?? []) {
    const category = categoryBySlug.get(row.slug);
    if (!category) continue;
    subcategoryIdOf.set(category, row.id);
    categoryOf.set(row.id, category);
  }
  const kindIdOf = new Map<'offer' | 'request', string>();
  for (const row of unwrapCall('table:post_kinds', kinds) ?? []) {
    for (const direction of ['offer', 'request'] as const) {
      const fits = row.direction === direction || row.direction === 'either';
      if (fits && !kindIdOf.has(direction)) kindIdOf.set(direction, row.id);
    }
  }
  return { subcategoryIdOf, categoryOf, kindIdOf };
}

/** The items-world catalog; a failed read is not cached, so the next call retries. */
export function loadPostCatalog(client: SupabaseClient<Database>): Promise<PostCatalog> {
  const cached = cache.get(client);
  if (cached) return cached;
  const pending = readCatalog(client);
  cache.set(client, pending);
  pending.catch(() => cache.delete(client));
  return pending;
}

/** The kind id a new post of `type` needs; a catalog without it cannot take a post (degrade rule). */
export function requireKindId(catalog: PostCatalog, type: PostType): string {
  const id = catalog.kindIdOf.get(directionOf(type));
  if (!id) throw new BackendUnavailableError('table:post_kinds', 'relation');
  return id;
}

/** The subcategory id of `category`; a catalog without it cannot take a post (degrade rule). */
export function requireSubcategoryId(catalog: PostCatalog, category: Category): string {
  const id = catalog.subcategoryIdOf.get(category);
  if (!id) throw new BackendUnavailableError('table:item_subcategories', 'relation');
  return id;
}
