import type { SupabaseClient } from '@supabase/supabase-js';
import type { Post } from '@kc/domain';
import type { Database } from '../database.types';
import { POST_SELECT_BARE, mapPostRow, type PostJoinedRow } from './mapPostRow';

export async function fetchPostById(
  client: SupabaseClient<Database>,
  postId: string,
): Promise<Post | null> {
  const { data, error } = await client
    .from('posts')
    .select(POST_SELECT_BARE)
    .eq('post_id', postId)
    .maybeSingle();
  if (error) throw new Error(`fetchPostById: ${error.message}`);
  if (!data) return null;
  return mapPostRow(data as unknown as PostJoinedRow);
}

export async function countOpenByUser(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<number> {
  const { count, error } = await client
    .from('posts')
    .select('post_id', { count: 'exact', head: true })
    .eq('owner_id', userId)
    .eq('status', 'open');
  if (error) throw new Error(`countOpenByUser: ${error.message}`);
  return count ?? 0;
}

/** FR-PROFILE-013 — viewer-aware profile headline counter (open + closed). */
export async function countProfilePostsForViewer(
  client: SupabaseClient<Database>,
  ownerId: string,
  viewerId: string | null,
): Promise<number> {
  const { data, error } = await client.rpc('active_posts_count_for_viewer', {
    p_owner: ownerId,
    // @ts-expect-error SQL accepts null p_viewer (guest); generated Args type is stricter
    p_viewer: viewerId,
  });
  if (error) throw new Error(`countProfilePostsForViewer: ${error.message}`);
  return data ?? 0;
}

/** FR-PROFILE-001 AC4 — open-tab row count (RLS applies for non-owner viewers). */
export async function countProfileOpenPosts(
  client: SupabaseClient<Database>,
  ownerId: string,
  options?: { excludeOnlyMe?: boolean },
): Promise<number> {
  let q = client
    .from('posts')
    .select('post_id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    // Feed mirrors of listings are counted with the listings, not here (D-206).
    .is('listing_id', null)
    .eq('status', 'open');
  if (options?.excludeOnlyMe) q = q.neq('visibility', 'OnlyMe');
  const { count, error } = await q;
  if (error) throw new Error(`countProfileOpenPosts: ${error.message}`);
  return count ?? 0;
}

/** FR-PROFILE-001 AC4 — closed-tab row count (matches profile_closed_posts filters). */
export async function countProfileClosedPosts(
  client: SupabaseClient<Database>,
  profileUserId: string,
  viewerUserId: string | null,
  listMode: 'standard' | 'owner_only_me' = 'standard',
): Promise<number> {
  const { data, error } = await client.rpc(
    'profile_closed_posts_count' as never,
    {
      p_profile_user_id: profileUserId,
      p_viewer_user_id: viewerUserId,
      p_list_mode: listMode,
    } as never,
  );
  if (error) throw new Error(`countProfileClosedPosts: ${error.message}`);
  return typeof data === 'number' ? data : 0;
}
