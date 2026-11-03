// Closure methods extracted from SupabasePostRepository to keep the parent
// file under the size cap. See FR-CLOSURE-001..005.
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { type ClosureCandidate, PostError, type PostErrorCode } from '@kc/application';
import type { Post } from '@kc/domain';
import type { Database } from '../database.types';
import { mapPostRow, POST_SELECT_BARE, type PostJoinedRow } from './mapPostRow';

const CLOSURE_CODES = new Set<PostErrorCode>([
  'closure_not_owner',
  'closure_wrong_status',
  'closure_recipient_not_in_chat',
  'reopen_window_expired',
  'republish_not_owner',
  'republish_wrong_status',
  'republish_not_found',
  'active_post_limit_exceeded',
]);

export function mapClosurePgError(error: PostgrestError): PostError {
  const msg = error.message?.trim() ?? '';
  if (CLOSURE_CODES.has(msg as PostErrorCode))
    return new PostError(msg as PostErrorCode, msg, error);
  // INSERT policy WITH CHECK miss for FollowersOnly without Private profile
  // surfaces as 42501 with a generic message — map it explicitly so callers
  // can show the right copy.
  if (error.code === '42501') {
    return new PostError('followers_only_requires_private', 'followers_only_requires_private', error);
  }
  return new PostError('unknown', error.message ?? 'closure_unknown', error);
}

async function fetchPostById(
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

export async function closePost(
  client: SupabaseClient<Database>,
  postId: string,
  recipientUserId: string | null,
): Promise<Post> {
  if (recipientUserId !== null) {
    // Atomic RPC (0015): insert recipient + flip status; triggers cascade counters.
    const { error } = await client.rpc('close_post_with_recipient', {
      p_post_id: postId,
      p_recipient_user_id: recipientUserId,
    });
    if (error) throw mapClosurePgError(error);
    const reread = await fetchPostById(client, postId);
    if (!reread) throw new PostError('unknown', `post ${postId} disappeared after close`);
    return reread;
  }
  // Close without recipient: single-table UPDATE gated on status='open' to
  // prevent a race where a concurrent close_post_with_recipient already moved
  // the post to closed_delivered (B7). If the gate misses, no rows are
  // affected and we surface a typed error.
  const deleteAfter = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: updated, error } = await client
    .from('posts')
    .update({ status: 'deleted_no_recipient', delete_after: deleteAfter })
    .eq('post_id', postId)
    .eq('status', 'open')
    .select('post_id');
  if (error) throw mapClosurePgError(error);
  if (!updated || updated.length === 0) {
    throw new PostError('closure_wrong_status', 'closure_wrong_status');
  }
  const reread = await fetchPostById(client, postId);
  if (!reread) throw new PostError('unknown', `post ${postId} disappeared after close`);
  return reread;
}

export async function reopenPost(
  client: SupabaseClient<Database>,
  postId: string,
): Promise<Post> {
  const { data: current, error: readErr } = await client
    .from('posts')
    .select('status, reopen_count')
    .eq('post_id', postId)
    .single();
  if (readErr) throw mapClosurePgError(readErr);

  if (current.status === 'closed_delivered') {
    // Atomic RPC (0015): delete recipient + flip status + reopen_count++.
    const { error } = await client.rpc('reopen_post_marked', { p_post_id: postId });
    if (error) throw mapClosurePgError(error);
  } else if (current.status === 'deleted_no_recipient') {
    // RPC (0068): owner-gated flip back to open + reopen_count++. Replaces a
    // direct client UPDATE because reopen_count is no longer in the posts
    // column grant (audit §15.5 — column was inflatable to game the queue).
    const { error } = await client.rpc('reopen_post_deleted_no_recipient', {
      p_post_id: postId,
    });
    if (error) throw mapClosurePgError(error);
  } else {
    throw new PostError('closure_wrong_status', 'closure_wrong_status');
  }

  const reread = await fetchPostById(client, postId);
  if (!reread) throw new PostError('unknown', `post ${postId} disappeared after reopen`);
  return reread;
}

export async function republishPost(
  client: SupabaseClient<Database>,
  postId: string,
): Promise<string> {
  const { data, error } = await client.rpc('rpc_republish_post', { p_post_id: postId });
  if (error) throw mapClosurePgError(error);
  if (typeof data !== 'string') {
    throw new PostError('unknown', 'republish_no_id_returned');
  }
  return data;
}

export async function getClosureCandidates(
  client: SupabaseClient<Database>,
  postId: string,
): Promise<ClosureCandidate[]> {
  // Read post owner first — chat sides are owner vs partner.
  const { data: ownerRow, error: ownerErr } = await client
    .from('posts')
    .select('owner_id')
    .eq('post_id', postId)
    .single();
  if (ownerErr) throw mapClosurePgError(ownerErr);
  const ownerId = ownerRow.owner_id;
  if (!ownerId) {
    throw new PostError('unknown', 'post_missing_owner');
  }

  // FR-CLOSURE-003 AC1: partners in chats anchored to this post only.
  const { data: chats, error: chatErr } = await client
    .from('chats')
    .select('chat_id, participant_a, participant_b, last_message_at, is_support_thread, removed_at')
    .eq('anchor_post_id', postId)
    .or(`participant_a.eq.${ownerId},participant_b.eq.${ownerId}`)
    .eq('is_support_thread', false)
    .is('removed_at', null);
  if (chatErr) throw mapClosurePgError(chatErr);

  // Dedupe by partner userId, keep latest last_message_at.
  const partners = new Map<string, string>();
  for (const c of chats ?? []) {
    const rawOther = c.participant_a === ownerId ? c.participant_b : c.participant_a;
    // SET NULL on deleted accounts — skip; otherwise `.in('user_id', …)` can send
    // invalid UUIDs and Postgres returns: invalid input syntax for type uuid: "null".
    const otherId = rawOther ?? '';
    if (!otherId || otherId === ownerId) continue;
    if (!c.last_message_at) continue;
    const prev = partners.get(otherId);
    if (!prev || prev < c.last_message_at) partners.set(otherId, c.last_message_at);
  }
  if (partners.size === 0) return [];

  const ids = Array.from(partners.keys()).filter((uid) => uid.length > 0);
  if (ids.length === 0) return [];
  const { data: users, error: usersErr } = await client
    .from('users')
    .select('user_id, display_name, avatar_url, city_name')
    .in('user_id', ids);
  if (usersErr) throw mapClosurePgError(usersErr);

  return (users ?? [])
    .map((u) => ({
      userId: u.user_id,
      fullName: u.display_name ?? null,
      avatarUrl: u.avatar_url,
      cityName: u.city_name ?? null,
      lastMessageAt: partners.get(u.user_id) ?? '',
    }))
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
}
