import type { SupabaseClient } from '@supabase/supabase-js';
import type { Post } from '@kc/domain';
import type { Database } from '../database.legacy.types';
import { POST_SELECT_BARE, mapPostRow, type PostJoinedRow } from './mapPostRow';

export type ProfileOpenLinksMode = 'standard' | 'owner_only_me';

/** Challenge posts linked to the profile user (join surface), merged into an owner open page. */
export async function fetchProfileOpenChallengePosts(
  client: SupabaseClient<Database>,
  profileUserId: string,
  viewerUserId: string | null,
  listMode: ProfileOpenLinksMode,
): Promise<Post[]> {
  const { data: ids, error } = await client.rpc(
    'profile_open_challenge_post_ids' as never,
    {
      p_profile_user_id: profileUserId,
      p_viewer_user_id: viewerUserId,
      p_list_mode: listMode,
    } as never,
  );
  if (error) throw new Error(`fetchProfileOpenChallengePosts: ${error.message}`);
  const postIds = (ids ?? []) as string[];
  if (postIds.length === 0) return [];

  const { data, error: fetchErr } = await client
    .from('posts')
    .select(POST_SELECT_BARE)
    .in('post_id', postIds);
  if (fetchErr) throw new Error(`fetchProfileOpenChallengePosts: ${fetchErr.message}`);
  return (data ?? []).map((row) => mapPostRow(row as unknown as PostJoinedRow));
}

export function mergePostsByCreatedAt(ownerPage: Post[], linked: Post[], limit: number): Post[] {
  const byId = new Map<string, Post>();
  for (const p of [...ownerPage, ...linked]) byId.set(p.postId, p);
  const merged = [...byId.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return merged.slice(0, limit);
}
