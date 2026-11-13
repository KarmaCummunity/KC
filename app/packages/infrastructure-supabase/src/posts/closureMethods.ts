// Closure methods of SupabasePostRepository (FR-CLOSURE-001..011): mark as delivered, reopen,
// republish, un-mark, and the recipient picker's candidates. Each is one baseline RPC; the post is
// read again afterwards because the RPCs return the handoff or nothing.

import type { SupabaseClient } from '@supabase/supabase-js';
import { PostError, type ClosureCandidate, type CreatePostInput } from '@kc/application';
import type { Post } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { hydrateUsers } from '../users/userReads';
import { USER_COLUMNS } from '../users/mapUserRow';
import { toPostError } from './postErrors';
import { createPost } from './postWriteMethods';
import { copyPostPhotos } from './postMediaCopy';
import { fetchPostDetail } from './postRepoQueries';

type Client = SupabaseClient<Database>;

async function reread(client: Client, postId: string, action: string): Promise<Post> {
  const post = await fetchPostDetail(client, postId);
  if (!post) throw new PostError('unknown', `post ${postId} disappeared after ${action}`);
  return post;
}

/** FR-CLOSURE-001..003: closes an open post, naming who received it or nobody. */
export async function closePost(client: Client, postId: string, recipientUserId: string | null): Promise<Post> {
  try {
    if (recipientUserId !== null) {
      unwrapCall(
        'rpc:close_post_with_recipient',
        await client.rpc('close_post_with_recipient', { p_post_id: postId, p_recipient_id: recipientUserId }),
      );
    } else {
      unwrapCall(
        'rpc:close_post_without_recipient',
        await client.rpc('close_post_without_recipient', { p_post_id: postId }),
      );
    }
  } catch (error) {
    throw toPostError(error);
  }
  return reread(client, postId, 'close');
}

/** FR-CLOSURE-011: "assign" names the recipient, "close_without" closes with nobody named. */
export async function ownerCompleteOffer(
  client: Client,
  targetId: string,
  recipientUserId: string | null,
  mode: 'assign' | 'close_without',
): Promise<{ closed: boolean }> {
  if (mode === 'assign' && recipientUserId === null) {
    throw new PostError('closure_recipient_not_in_chat', 'assign needs a recipient');
  }
  await closePost(client, targetId, mode === 'assign' ? recipientUserId : null);
  return { closed: true };
}

/** FR-CLOSURE-005: reopens a delivered post, or a deleted one inside its seven-day window. */
export async function reopenPost(client: Client, postId: string): Promise<Post> {
  try {
    unwrapCall('rpc:reopen_post', await client.rpc('reopen_post', { p_post_id: postId }));
  } catch (error) {
    throw toPostError(error);
  }
  return reread(client, postId, 'reopen');
}

/** FR-CLOSURE-007: the recipient removes their own mark. */
export async function unmarkRecipientSelf(client: Client, postId: string): Promise<void> {
  try {
    unwrapCall('rpc:recipient_unmark_self', await client.rpc('recipient_unmark_self', { p_post_id: postId }));
  } catch (error) {
    throw toPostError(error);
  }
}

/**
 * FR-POST-013 AC3, D127: an expired post is never reopened; republishing publishes a new post with the
 * old one's fields and copies of its photos (a stored file belongs to one row, so each photo is
 * copied into a fresh batch of the owner's folder; see postMediaCopy.ts).
 */
export async function republishPost(client: Client, postId: string): Promise<string> {
  const old = await fetchPostDetail(client, postId);
  if (!old) throw new PostError('republish_not_found', 'republish_not_found');
  const batch = `republish-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const mediaAssets = await copyPostPhotos(client, old.ownerId, old.mediaAssets, batch);
  const copy: CreatePostInput = {
    ownerId: old.ownerId,
    type: old.type,
    visibility: old.visibility,
    title: old.title,
    description: old.description,
    category: old.category,
    address: old.address,
    locationDisplayLevel: old.locationDisplayLevel,
    itemCondition: old.itemCondition,
    urgency: old.urgency,
    estimatedValue: old.estimatedValue,
    mediaAssets,
  };
  return createPost(client, copy);
}

/** The other member of every direct chat anchored to the post, with the latest message time. */
async function chatPartners(client: Client, postId: string, ownerId: string): Promise<Map<string, string>> {
  const chats = unwrapCall(
    'table:chats',
    await client
      .from('chats')
      .select('direct_user_a, direct_user_b, last_message_at')
      .eq('anchor_post_id', postId)
      .eq('kind', 'direct'),
  );
  const partners = new Map<string, string>();
  for (const chat of chats ?? []) {
    const other = chat.direct_user_a === ownerId ? chat.direct_user_b : chat.direct_user_a;
    // A deleted account leaves a null side; a chat without messages is not a candidate.
    if (!other || other === ownerId || !chat.last_message_at) continue;
    const previous = partners.get(other);
    if (!previous || previous < chat.last_message_at) partners.set(other, chat.last_message_at);
  }
  return partners;
}

/** FR-CLOSURE-003 AC1/AC2: the members the owner talked to about this post, latest conversation first. */
export async function getClosureCandidates(client: Client, postId: string): Promise<ClosureCandidate[]> {
  const post = unwrapCall(
    'table:posts',
    await client.from('posts').select('owner_id').eq('id', postId).maybeSingle(),
  );
  if (!post) throw new PostError('not_found', 'post not found');
  const partners = await chatPartners(client, postId, post.owner_id);
  if (partners.size === 0) return [];
  const rows = unwrapCall(
    'table:users',
    await client.from('users').select(USER_COLUMNS).in('id', [...partners.keys()]),
  );
  const users = await hydrateUsers(client, rows ?? []);
  return users
    .map((user) => ({
      userId: user.userId,
      fullName: user.displayName,
      avatarUrl: user.avatarUrl,
      cityName: user.cityName,
      lastMessageAt: partners.get(user.userId) ?? '',
    }))
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
}
