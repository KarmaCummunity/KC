import type { SupabaseClient } from '@supabase/supabase-js';
import type { Post, PostStatus, PostVisibility } from '@kc/domain';
import type { Database } from '../database.legacy.types';
import { POST_SELECT_BARE, mapPostRow, type PostJoinedRow } from './mapPostRow';
import { decodeCursor, encodeCursor } from './cursor';
import {
  fetchProfileOpenChallengePosts,
  mergePostsByCreatedAt,
  type ProfileOpenLinksMode,
} from './mergeProfileOpenChallengePosts';

const MY_POSTS_PAGE_MAX = 100;

export type GetMyPostsProfileOpenLinks = {
  readonly viewerUserId: string | null;
  readonly listMode: ProfileOpenLinksMode;
};

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
  profileOpenLinks?: GetMyPostsProfileOpenLinks,
): Promise<{ posts: Post[]; nextCursor: string | null }> {
  if (status.length === 0) return { posts: [], nextCursor: null };
  const safeLimit = Math.max(1, Math.min(limit, MY_POSTS_PAGE_MAX));
  const decoded = decodeCursor(cursor);

  let q = client
    .from('posts')
    .select(POST_SELECT_BARE)
    .eq('owner_id', userId)
    // Posts of every giving world; feed-hidden ones (e.g. later recurring-ride occurrences, 0557) are not listed.
    .eq('feed_hidden', false)
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
  let posts = page.map(mapPostRow);

  const mergeLinks =
    profileOpenLinks &&
    status.length === 1 &&
    status[0] === 'open' &&
    !cursor;
  if (mergeLinks) {
    const linked = await fetchProfileOpenChallengePosts(
      client,
      userId,
      profileOpenLinks.viewerUserId,
      profileOpenLinks.listMode,
    );
    posts = mergePostsByCreatedAt(posts, linked, safeLimit);
    return { posts, nextCursor: null };
  }

  const last = posts[posts.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt }) : null;
  return { posts, nextCursor };
}
