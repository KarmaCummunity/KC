import type { SupabaseClient } from '@supabase/supabase-js';
import type { GuestPost, GuestProfile, IGuestProfileRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type ProfileRow = Database['public']['Functions']['guest_profile']['Returns'][number];
type PostRow = Database['public']['Functions']['guest_profile_posts']['Returns'][number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mapProfile = (row: ProfileRow): GuestProfile => ({
  shareHandle: row.share_handle,
  displayName: row.display_name,
  avatarUrl: row.avatar_url || null,
  biography: row.biography || null,
  cityNameHe: row.city_name_he || null,
  cityNameEn: row.city_name_en || null,
  verificationLevel: row.verification_level,
  followersCount: row.followers_count,
  followingCount: row.following_count,
  itemsGivenCount: row.items_given_count,
  itemsReceivedCount: row.items_received_count,
  openPostsCount: row.open_posts_count,
});

const mapPost = (row: PostRow): GuestPost => ({
  id: row.id,
  title: row.title,
  description: row.description,
  cityNameHe: row.city_name_he,
  cityNameEn: row.city_name_en,
});

/** Guest public profile + that member's open Public posts (anon only). */
export class SupabaseGuestProfileRepository implements IGuestProfileRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getByHandle(shareHandle: string): Promise<GuestProfile | null> {
    const rows = unwrapCall(
      'rpc:guest_profile',
      await this.client.rpc('guest_profile', { p_share_handle: shareHandle }),
    );
    return rows?.[0] ? mapProfile(rows[0]) : null;
  }

  async listPosts(shareHandle: string, beforeId?: string): Promise<readonly GuestPost[]> {
    if (beforeId && !UUID.test(beforeId)) return [];
    const rows = unwrapCall(
      'rpc:guest_profile_posts',
      await this.client.rpc('guest_profile_posts', {
        p_share_handle: shareHandle,
        p_limit: 20,
        ...(beforeId ? { p_before_id: beforeId } : {}),
      }),
    );
    return (rows ?? []).map(mapPost);
  }
}
