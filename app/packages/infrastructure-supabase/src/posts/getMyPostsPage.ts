// A member's posts filtered by status and audience, newest first (FR-POST-016, FR-PROFILE-001).
//
// Used where `profile_posts_page`'s three fixed tabs do not fit: the owner's "removed" list (statuses
// an admin or a report set), the Hidden screen, and the owner's delivered / deleted "only me" posts.
// The ids come from `posts` under the caller's row-level security (so another member's list holds
// only what the caller may read) and are completed into cards by `post_cards`.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostStatus, PostVisibility } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { encodeKeysetCursor, keysetAfterFilter, parseKeysetCursor } from './pageCursor';
import { clampPageLimit, fetchPostsByIds, type PostsPage } from './postCardPages';

type Client = SupabaseClient<Database>;

export interface OwnerPostsFilter {
  readonly statuses: readonly PostStatus[];
  readonly visibility?: PostVisibility;
  readonly excludeVisibility?: PostVisibility;
}

/** One page (newest first, keyset on `(created_at, id)`) of the posts of `ownerId` matching `filter`. */
export async function listOwnerPostsPage(
  client: Client,
  ownerId: string,
  filter: OwnerPostsFilter,
  limit: number,
  cursor?: string,
): Promise<PostsPage> {
  if (filter.statuses.length === 0) return { posts: [], nextCursor: null };
  const size = clampPageLimit(limit);
  let query = client
    .from('posts')
    .select('id, created_at')
    .eq('owner_id', ownerId)
    .in('status', [...filter.statuses])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(size + 1);
  if (filter.visibility) query = query.eq('visibility', filter.visibility);
  if (filter.excludeVisibility) query = query.neq('visibility', filter.excludeVisibility);
  const after = parseKeysetCursor(cursor);
  if (after) query = query.or(keysetAfterFilter('created_at', 'id', after));

  const rows = unwrapCall('table:posts', await query) ?? [];
  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  const posts = await fetchPostsByIds(client, page.map((row) => row.id));
  const nextCursor = rows.length > size && last ? encodeKeysetCursor({ t: last.created_at, id: last.id }) : null;
  return { posts, nextCursor };
}
