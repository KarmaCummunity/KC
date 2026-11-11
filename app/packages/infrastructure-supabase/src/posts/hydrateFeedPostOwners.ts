// FR-FEED-001 — recover owner display fields when the posts→users embed is empty
// (e.g. feed_visible_posts + RLS) without treating the post as a deleted account.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostWithOwner } from '@kc/application';
import { toVerificationLevel } from '@kc/domain';
import type { Database } from '../database.legacy.types';

type PublicUserRow = Pick<
  Database['public']['Views']['users_public']['Row'],
  'user_id' | 'display_name' | 'avatar_url' | 'share_handle' | 'privacy_mode' | 'verification_level'
>;

/** Fill missing ownerName/handle/avatar from users_public before orphan-drop. */
export async function hydrateFeedPostOwners(
  client: SupabaseClient<Database>,
  posts: readonly PostWithOwner[],
): Promise<PostWithOwner[]> {
  const needsOwner = posts.filter(
    (p) => p.ownerId && !(p.ownerName?.trim() || p.ownerHandle?.trim()),
  );
  if (needsOwner.length === 0) return [...posts];

  const ownerIds = [...new Set(needsOwner.map((p) => p.ownerId))];
  const { data, error } = await client
    .from('users_public')
    .select('user_id, display_name, avatar_url, share_handle, privacy_mode, verification_level')
    .in('user_id', ownerIds);
  if (error) throw new Error(`hydrateFeedPostOwners: ${error.message}`);

  const byId = new Map<string, PublicUserRow>();
  for (const row of data ?? []) {
    if (row.user_id) byId.set(row.user_id, row);
  }
  if (byId.size === 0) return [...posts];

  return posts.map((post) => {
    if (post.ownerName?.trim() || post.ownerHandle?.trim()) return post;
    const u = byId.get(post.ownerId);
    if (!u) return post;
    return {
      ...post,
      ownerName: u.display_name ?? post.ownerName,
      ownerAvatarUrl: u.avatar_url ?? post.ownerAvatarUrl,
      ownerHandle: u.share_handle ?? post.ownerHandle,
      ownerPrivacyMode: (u.privacy_mode === 'Private' ? 'Private' : 'Public') as PostWithOwner['ownerPrivacyMode'],
      ownerVerificationLevel: toVerificationLevel(u.verification_level),
    };
  });
}
