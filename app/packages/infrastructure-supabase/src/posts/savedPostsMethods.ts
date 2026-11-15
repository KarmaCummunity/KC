// FR-POST-022 — saved posts (bookmarks): the caller's own `saved_posts` rows, listed as cards.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Post } from '@kc/domain';
import { PostError } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { sessionUserId } from '../users/userReads';
import { encodeKeysetCursor, keysetAfterFilter, parseKeysetCursor } from './pageCursor';
import { clampPageLimit, fetchPostsByIds } from './postCardPages';

type Client = SupabaseClient<Database>;

async function requireUserId(client: Client): Promise<string> {
  const userId = await sessionUserId(client);
  if (!userId) throw new PostError('forbidden', 'saved_posts: not authenticated');
  return userId;
}

/** Saves a post; saving it twice is not an error (the table has no update grant, so duplicates are ignored). */
export async function savePostRow(client: Client, postId: string): Promise<void> {
  const userId = await requireUserId(client);
  unwrapCall(
    'table:saved_posts',
    await client
      .from('saved_posts')
      .upsert({ user_id: userId, post_id: postId }, { onConflict: 'user_id,post_id', ignoreDuplicates: true }),
  );
}

export async function unsavePostRow(client: Client, postId: string): Promise<void> {
  unwrapCall('table:saved_posts', await client.from('saved_posts').delete().eq('post_id', postId));
}

export async function isPostSavedRow(client: Client, postId: string): Promise<boolean> {
  const row = unwrapCall(
    'table:saved_posts',
    await client.from('saved_posts').select('post_id').eq('post_id', postId).maybeSingle(),
  );
  return row !== null;
}

/**
 * The caller's saved posts, most recently saved first. The ids are paged by `(saved_at, post_id)` and
 * completed into cards by `post_cards`; a saved post the caller can no longer read is simply absent.
 */
export async function listSavedPostsPage(
  client: Client,
  limit: number,
  cursor?: string,
): Promise<{ posts: Post[]; nextCursor: string | null }> {
  const userId = await requireUserId(client);
  const size = clampPageLimit(limit);
  let query = client
    .from('saved_posts')
    .select('post_id, saved_at')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false })
    .order('post_id', { ascending: false })
    .limit(size + 1);
  const after = parseKeysetCursor(cursor);
  if (after) query = query.or(keysetAfterFilter('saved_at', 'post_id', after));

  const rows = unwrapCall('table:saved_posts', await query) ?? [];
  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  const posts = await fetchPostsByIds(client, page.map((row) => row.post_id));
  const nextCursor = rows.length > size && last ? encodeKeysetCursor({ t: last.saved_at, id: last.post_id }) : null;
  return { posts, nextCursor };
}
