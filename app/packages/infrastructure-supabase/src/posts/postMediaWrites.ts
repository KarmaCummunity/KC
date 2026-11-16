// Photo rows of a post (`post_media`, FR-POST-005, FR-POST-008 AC1).
//
// The file is uploaded to the `post-images` bucket under the member's own folder first; this module
// records the row (`pending` until the media pipeline marks it `ready`). A new post inserts its rows
// directly. An edit goes through `replace_post_media`, which makes the gallery match in one
// transaction: the server refuses to delete the last photo of a live offer (D132), so a delete
// followed by an insert from the device could not swap the only photo of a post (KC#2118).

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

/**
 * Makes the post's photos exactly `assets`, in order. The server keeps the rows whose file and
 * position are unchanged (they stay processed) and rewrites the rest; a live offer of a photo
 * world that would be left without a photo is refused (`offer_photo_required`).
 */
export async function replacePostMedia(
  client: Client,
  postId: string,
  assets: readonly MediaAssetInput[],
): Promise<void> {
  unwrapCall(
    'rpc:replace_post_media',
    await client.rpc('replace_post_media', {
      p_post_id: postId,
      p_media: assets.map((asset) => ({
        storage_key: asset.path,
        mime_type: asset.mimeType,
        size_bytes: asset.sizeBytes,
      })),
    }),
  );
}
