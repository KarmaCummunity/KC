import type { SupabaseClient } from '@supabase/supabase-js';
import type { Post, PostStatus, PostVisibility } from '@kc/domain';
import type { Database } from '../database.types';
import { POST_SELECT_BARE, mapPostRow, type PostJoinedRow } from './mapPostRow';
import { decodeCursor, encodeCursor } from './cursor';

const MY_POSTS_PAGE_MAX = 100;

/**
 * Audit §3.10 — paginated owner's posts for profile; `safeLimit + 1` probe for `nextCursor`.
 */
export async function getMyPostsPage(
  client: SupabaseClient<Database>,
  userId: string,
  status: PostStatus[],
  limit: number,
  cursor?: string,
  visibility?: PostVisibility,
  excludeVisibility?: PostVisibility,
): Promise<{ posts: Post[]; nextCursor: string | null }> {
  if (status.length === 0) return { posts: [], nextCursor: null };
  const safeLimit = Math.max(1, Math.min(limit, MY_POSTS_PAGE_MAX));
  const decoded = decodeCursor(cursor);

  let q = client
    .from('posts')
    .select(POST_SELECT_BARE)
    .eq('owner_id', userId)
    // Feed mirrors of listings are listed with the listings, not here (D-206).
    .is('listing_id', null)
    .in('status', status)
    .order('created_at', { ascending: false })
    .limit(safeLimit + 1);

  if (visibility) q = q.eq('visibility', visibility);
  if (excludeVisibility) q = q.neq('visibility', excludeVisibility);

  if (decoded) q = q.lt('created_at', decoded.createdAt);

  const { data, error } = await q;
  if (error) throw new Error(`getMyPosts: ${error.message}`);
  const rows = (data ?? []) as unknown as PostJoinedRow[];
  const hasMore = rows.length > safeLimit;
  const page = hasMore ? rows.slice(0, safeLimit) : rows;
  const posts = page.map(mapPostRow);
  const last = posts[posts.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt }) : null;
  return { posts, nextCursor };
}
