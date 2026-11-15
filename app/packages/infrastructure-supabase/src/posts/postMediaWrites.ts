// Photo rows of a post (`post_media`, FR-POST-005, FR-POST-008 AC1).
//
// The file is uploaded to the `post-images` bucket under the member's own folder first; this module
// records the row (`pending` until the media pipeline marks it `ready`). A device may insert and
// delete its own rows but never update one, so an edit keeps the rows whose file and position are
// unchanged (they stay `ready`), deletes the rest, and inserts the new ones.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MediaAssetInput } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type Client = SupabaseClient<Database>;

const POST_IMAGES_BUCKET = 'post-images';

function toMediaRow(postId: string, ownerId: string, asset: MediaAssetInput, ordinal: number) {
  return {
    post_id: postId,
    owner_id: ownerId,
    kind: 'image',
    storage_bucket: POST_IMAGES_BUCKET,
    storage_key: asset.path,
    ordinal,
    mime_type: asset.mimeType,
    size_bytes: asset.sizeBytes,
  };
}

/** Records the photos of a new post, in the given order. */
export async function writePostMedia(
  client: Client,
  postId: string,
  ownerId: string,
  assets: readonly MediaAssetInput[],
): Promise<void> {
  if (assets.length === 0) return;
  unwrapCall(
    'table:post_media',
    await client.from('post_media').insert(assets.map((asset, ordinal) => toMediaRow(postId, ownerId, asset, ordinal))),
  );
}

/** Makes the post's photos exactly `assets`, in order, touching only the rows that differ. */
export async function replacePostMedia(
  client: Client,
  postId: string,
  ownerId: string,
  assets: readonly MediaAssetInput[],
): Promise<void> {
  const existing =
    unwrapCall(
      'table:post_media',
      await client.from('post_media').select('id, storage_key, ordinal').eq('post_id', postId),
    ) ?? [];
  const wanted = new Map(assets.map((asset, ordinal) => [`${ordinal}|${asset.path}`, ordinal]));
  const kept = new Set<string>();
  const staleIds: string[] = [];
  for (const row of existing) {
    const key = `${row.ordinal}|${row.storage_key}`;
    if (wanted.has(key)) kept.add(key);
    else staleIds.push(row.id);
  }
  if (staleIds.length > 0) {
    unwrapCall('table:post_media', await client.from('post_media').delete().in('id', staleIds));
  }
  const missing = assets.flatMap((asset, ordinal) =>
    kept.has(`${ordinal}|${asset.path}`) ? [] : [toMediaRow(postId, ownerId, asset, ordinal)],
  );
  if (missing.length > 0) unwrapCall('table:post_media', await client.from('post_media').insert(missing));
}
