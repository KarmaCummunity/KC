// FR-POST-022 — saved_posts adapter helpers (keeps SupabasePostRepository under LOC cap).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Post } from '@kc/domain';
import type { Database } from '../database.legacy.types';
import { POST_SELECT_BARE, mapPostRow, type PostJoinedRow } from './mapPostRow';
import {
  decodeSavedPostsCursor,
  encodeSavedPostsCursor,
} from './savedPostsCursor';

const SAVED_PAGE_MAX = 100;

type SavedRow = {
  saved_at: string;
  post_id: string;
  posts: PostJoinedRow | null;
};

async function requireUserId(client: SupabaseClient<Database>): Promise<string> {
  const userId = (await client.auth.getUser()).data.user?.id ?? null;
  if (!userId) throw new Error('saved_posts: not authenticated');
  return userId;
}

export async function savePostRow(client: SupabaseClient<Database>, postId: string): Promise<void> {
  const userId = await requireUserId(client);
  const { error } = await client.from('saved_posts').upsert(
    { user_id: userId, post_id: postId },
    { onConflict: 'user_id,post_id', ignoreDuplicates: true },
  );
  if (error) throw new Error(`savePost: ${error.message}`);
}

export async function unsavePostRow(client: SupabaseClient<Database>, postId: string): Promise<void> {
  const { error } = await client.from('saved_posts').delete().eq('post_id', postId);
  if (error) throw new Error(`unsavePost: ${error.message}`);
}

export async function isPostSavedRow(
  client: SupabaseClient<Database>,
  postId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('saved_posts')
    .select('post_id')
    .eq('post_id', postId)
    .maybeSingle();
  if (error) throw new Error(`isPostSaved: ${error.message}`);
  return data !== null;
}

export async function listSavedPostsPage(
  client: SupabaseClient<Database>,
  limit: number,
  cursor?: string,
): Promise<{ posts: Post[]; nextCursor: string | null }> {
  const userId = await requireUserId(client);
  const safeLimit = Math.max(1, Math.min(limit, SAVED_PAGE_MAX));
  const decoded = decodeSavedPostsCursor(cursor);

  let q = client
    .from('saved_posts')
    .select(`saved_at, post_id, posts (${POST_SELECT_BARE})`)
    .eq('user_id', userId)
    .order('saved_at', { ascending: false })
    .limit(safeLimit + 1);

  if (decoded) q = q.lt('saved_at', decoded.savedAt);

  const { data, error } = await q;
  if (error) throw new Error(`listSavedPosts: ${error.message}`);

  const rows = (data ?? []) as unknown as SavedRow[];
  const hasMore = rows.length > safeLimit;
  const page = hasMore ? rows.slice(0, safeLimit) : rows;

  const posts: Post[] = [];
  for (const row of page) {
    if (!row.posts) continue;
    posts.push(mapPostRow(row.posts));
  }

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeSavedPostsCursor({ savedAt: last.saved_at }) : null;
  return { posts, nextCursor };
}
