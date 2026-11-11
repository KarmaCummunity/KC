// Single-post read and the profile counters of SupabasePostRepository.
//
// One post is the card (`post_cards`) plus its gallery (`post_media`: every file for the owner,
// processed files for everybody else) and, for the owner, the exact street. The counters are row
// counts under the caller's own row-level security, so each viewer counts exactly the posts they
// could list.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostWithOwner } from '@kc/application';
import type { ProfileClosedPostsListMode } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { sessionUserId } from '../users/userReads';
import { mapCardToPostWithOwner, mapMediaRow, type PostCardRow } from './mapPostRow';
import { loadCardExtras } from './postCardExtras';
import { loadPostCatalog } from './postCatalog';

type Client = SupabaseClient<Database>;

async function loadGallery(client: Client, postId: string) {
  const rows = unwrapCall(
    'table:post_media',
    await client.from('post_media').select('*').eq('post_id', postId).order('ordinal'),
  );
  return (rows ?? []).map(mapMediaRow);
}

/** The exact street, readable by the post's owner only; null for everybody else or when none is stored. */
async function loadOwnStreet(client: Client, card: PostCardRow) {
  const viewerId = await sessionUserId(client);
  if (!viewerId || card.owner_id !== viewerId || !card.id) return undefined;
  const row = unwrapCall(
    'table:post_private_locations',
    await client.from('post_private_locations').select('street, street_number').eq('post_id', card.id).maybeSingle(),
  );
  return row ? { street: row.street ?? '', streetNumber: row.street_number ?? '' } : undefined;
}

/** One post with its owner, gallery and (for the owner) street; null when the caller cannot read it. */
export async function fetchPostDetail(client: Client, postId: string): Promise<PostWithOwner | null> {
  const cards = unwrapCall('rpc:post_cards', await client.rpc('post_cards', { p_post_ids: [postId] }));
  const card = cards?.[0];
  if (!card) return null;
  const [catalog, extras, media, street] = await Promise.all([
    loadPostCatalog(client),
    loadCardExtras(client, [card]),
    loadGallery(client, postId),
    loadOwnStreet(client, card),
  ]);
  return mapCardToPostWithOwner(card, { catalog, extras: extras.get(postId), media, street });
}

async function countPosts(
  client: Client,
  ownerId: string,
  shape: (query: ReturnType<typeof baseCount>) => ReturnType<typeof baseCount>,
): Promise<number> {
  const result = await shape(baseCount(client, ownerId));
  unwrapCall('table:posts', { data: null, error: result.error });
  return result.count ?? 0;
}

function baseCount(client: Client, ownerId: string) {
  return client.from('posts').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId);
}

/** Open posts of a member that the caller may see (all of them, for the member's own count). */
export function countOpenByUser(client: Client, userId: string): Promise<number> {
  return countPosts(client, userId, (query) => query.eq('status', 'open'));
}

/** FR-PROFILE-013: the headline counter, open and delivered posts the caller may see. */
export function countProfilePostsForViewer(client: Client, ownerId: string): Promise<number> {
  return countPosts(client, ownerId, (query) => query.in('status', ['open', 'closed_delivered']));
}

/** FR-PROFILE-001 AC4: the open tab's badge; `excludeOnlyMe` leaves out the owner's private posts. */
export function countProfileOpenPosts(
  client: Client,
  ownerId: string,
  options?: { excludeOnlyMe?: boolean },
): Promise<number> {
  return countPosts(client, ownerId, (query) => {
    const open = query.eq('status', 'open');
    return options?.excludeOnlyMe ? open.neq('visibility', 'OnlyMe') : open;
  });
}

/**
 * FR-PROFILE-001 AC4: the closed tab's badge. The standard list is `profile_closed_posts_count`; the
 * Hidden screen's list (the owner's "only me" posts, delivered or deleted) is counted over the same rows
 * it lists.
 */
export async function countProfileClosedPosts(
  client: Client,
  profileUserId: string,
  listMode: ProfileClosedPostsListMode = 'standard',
): Promise<number> {
  if (listMode === 'owner_only_me') {
    return countPosts(client, profileUserId, (query) =>
      query.eq('visibility', 'OnlyMe').in('status', ['closed_delivered', 'deleted_no_recipient']),
    );
  }
  const count = unwrapCall(
    'rpc:profile_closed_posts_count',
    await client.rpc('profile_closed_posts_count', { p_user_id: profileUserId }),
  );
  return count ?? 0;
}
