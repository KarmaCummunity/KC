// FR-POST-008 — post row + media_assets replace (keeps SupabasePostRepository small, TD-50).
import type { SupabaseClient } from '@supabase/supabase-js';
import { PostError } from '@kc/application';
import type { UpdatePostInput } from '@kc/application';
import type { Post } from '@kc/domain';
import type { Database } from '../database.types';

function mapUpdateError(error: { message?: string }): never {
  if (error.message?.includes('visibility_downgrade_forbidden')) {
    throw new PostError('visibility_downgrade_forbidden', error.message);
  }
  throw new Error(`update: ${error.message}`);
}

type PostUpdateRow = Database['public']['Tables']['posts']['Update'];

function toUpdateRow(patch: UpdatePostInput): PostUpdateRow {
  const row: PostUpdateRow = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.locationDisplayLevel !== undefined) row.location_display_level = patch.locationDisplayLevel;
  if (patch.itemCondition !== undefined) row.item_condition = patch.itemCondition;
  if (patch.urgency !== undefined) row.urgency = patch.urgency;
  if (patch.visibility !== undefined) row.visibility = patch.visibility;
  if (patch.address) {
    row.city = patch.address.city;
    row.street = patch.address.street;
    row.street_number = patch.address.streetNumber;
  }
  return row;
}

async function requirePost(
  fetchPostById: (pid: string) => Promise<Post | null>,
  postId: string,
  suffix = '',
): Promise<Post> {
  const post = await fetchPostById(postId);
  if (!post) throw new Error(`update: post ${postId} not found${suffix}`);
  return post;
}

async function replaceMedia(
  client: SupabaseClient<Database>,
  postId: string,
  assets: NonNullable<UpdatePostInput['mediaAssets']>,
): Promise<void> {
  const { error: delErr } = await client.from('media_assets').delete().eq('post_id', postId);
  if (delErr) throw new Error(`update.media_delete: ${delErr.message}`);
  if (assets.length === 0) return;
  const mediaRows = assets.map((m, i) => ({
    post_id: postId,
    ordinal: i,
    path: m.path,
    mime_type: m.mimeType,
    size_bytes: m.sizeBytes,
  }));
  const { error: insErr } = await client.from('media_assets').insert(mediaRows);
  if (insErr) throw new Error(`update.media_insert: ${insErr.message}`);
}

export async function executePostUpdate(
  client: SupabaseClient<Database>,
  postId: string,
  patch: UpdatePostInput,
  fetchPostById: (pid: string) => Promise<Post | null>,
): Promise<Post> {
  const updateRow = toUpdateRow(patch);
  const hasRowPatch = Object.keys(updateRow).length > 0;
  const hasMediaPatch = patch.mediaAssets !== undefined;

  if (!hasRowPatch && !hasMediaPatch) return requirePost(fetchPostById, postId);

  // Media-only edits still issue a no-op row update (title), as before.
  const rowWrite = hasRowPatch
    ? updateRow
    : { title: (await requirePost(fetchPostById, postId)).title };
  const { error } = await client.from('posts').update(rowWrite).eq('post_id', postId);
  if (error) mapUpdateError(error);

  if (hasMediaPatch) await replaceMedia(client, postId, patch.mediaAssets ?? []);

  return requirePost(fetchPostById, postId, ' after update');
}
