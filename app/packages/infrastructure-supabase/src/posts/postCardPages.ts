// Cards → domain posts, and the three baseline page functions that return cards
// (`feed_page`, `search_posts_page`, `profile_posts_page`) plus `post_cards` for ids held elsewhere.
//
// A page function returns at most 50 rows and, per row, the keyset cursor to continue after it.
// The adapter hands the last row's cursor on while the page is full; a short page is the last one.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostWithOwner } from '@kc/application';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { mapCardToPostWithOwner, type PostCardRow } from './mapPostRow';
import { loadCardExtras } from './postCardExtras';
import { loadPostCatalog } from './postCatalog';
import { decodePageCursor, encodePageCursor } from './pageCursor';

type Client = SupabaseClient<Database>;

/** Largest page the baseline page functions return. */
export const CARD_PAGE_MAX = 50;

export interface PostsPage {
  readonly posts: PostWithOwner[];
  readonly nextCursor: string | null;
}

/** One row of a page function: the card, the cursor after it, and (feed / search) the distance. */
interface CardRow {
  readonly card: PostCardRow;
  readonly next_cursor: Json;
  readonly distance_m?: number | null;
}

/** The page size the baseline will honour for a requested `limit`. */
export function clampPageLimit(limit: number): number {
  return Math.max(1, Math.min(Math.trunc(limit), CARD_PAGE_MAX));
}

/** Domain posts for `cards`, in the same order (a card without an id is dropped). */
export async function cardsToPosts(
  client: Client,
  cards: readonly PostCardRow[],
  distancesM: readonly (number | null | undefined)[] = [],
): Promise<PostWithOwner[]> {
  if (cards.length === 0) return [];
  const [catalog, extras] = await Promise.all([loadPostCatalog(client), loadCardExtras(client, cards)]);
  return cards.flatMap((card, index) =>
    card.id === null
      ? []
      : [mapCardToPostWithOwner(card, { catalog, extras: extras.get(card.id), distanceM: distancesM[index] })],
  );
}

/** A page of domain posts from the rows of a page function asked for `limit` rows. */
export async function rowsToPage(client: Client, rows: readonly CardRow[], limit: number): Promise<PostsPage> {
  const posts = await cardsToPosts(
    client,
    rows.map((row) => row.card),
    rows.map((row) => row.distance_m),
  );
  const last = rows[rows.length - 1];
  const full = rows.length >= clampPageLimit(limit);
  return { posts, nextCursor: full && last ? encodePageCursor(last.next_cursor) : null };
}

/** The posts with these ids that the caller may read, in the order of `ids`. */
export async function fetchPostsByIds(client: Client, ids: readonly string[]): Promise<PostWithOwner[]> {
  if (ids.length === 0) return [];
  const cards = unwrapCall('rpc:post_cards', await client.rpc('post_cards', { p_post_ids: [...ids] }));
  const byId = new Map((cards ?? []).map((card) => [card.id, card]));
  const ordered = ids.flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
  return cardsToPosts(client, ordered);
}

/** One page of `feed_page` with the given filters (`p_filters`). */
export async function fetchFeedPage(
  client: Client,
  filters: Json,
  limit: number,
  cursor?: string,
): Promise<PostsPage> {
  const rows = unwrapCall(
    'rpc:feed_page',
    await client.rpc('feed_page', {
      p_cursor: decodePageCursor(cursor) ?? undefined,
      p_limit: clampPageLimit(limit),
      p_filters: filters,
    }),
  );
  return rowsToPage(client, rows ?? [], limit);
}

/** One page of `search_posts_page` for a text of two or more characters. */
export async function fetchSearchPage(
  client: Client,
  query: string,
  filters: Json,
  limit: number,
  cursor?: string,
): Promise<PostsPage> {
  const rows = unwrapCall(
    'rpc:search_posts_page',
    await client.rpc('search_posts_page', {
      p_query: query,
      p_cursor: decodePageCursor(cursor) ?? undefined,
      p_limit: clampPageLimit(limit),
      p_filters: filters,
    }),
  );
  return rowsToPage(client, rows ?? [], limit);
}

/** One page of a profile tab (`open`, `closed`, `hidden`) of a member. */
export async function fetchProfileTabPage(
  client: Client,
  userId: string,
  tab: 'open' | 'closed' | 'hidden',
  limit: number,
  cursor?: string,
): Promise<PostsPage> {
  const rows = unwrapCall(
    'rpc:profile_posts_page',
    await client.rpc('profile_posts_page', {
      p_user_id: userId,
      p_tab: tab,
      p_cursor: decodePageCursor(cursor) ?? undefined,
      p_limit: clampPageLimit(limit),
    }),
  );
  return rowsToPage(client, rows ?? [], limit);
}
