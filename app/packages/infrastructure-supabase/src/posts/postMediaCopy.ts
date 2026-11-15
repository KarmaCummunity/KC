// Republish keeps the photos (FR-POST-013 AC3, D127).
//
// A stored file belongs to exactly one media row (`post_media_storage_object_key`), so the new post
// cannot point at the old post's files. Each photo is copied instead: the public file is read
// back from the `post-images` bucket and uploaded again under the owner's own folder in a fresh
// batch, `<owner>/<batch>/<ordinal>.jpg`, with its thumbnail `<ordinal>-thumb.jpg` when the
// source has one. The recorded type and size of each source row (migration 0008) go with it, so
// the new rows pass the same checks as an upload. A photo that cannot be copied is left out; the
// owner can add it again in the edit screen.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MediaAssetInput } from '@kc/application';
import type { MediaAsset } from '@kc/domain';
import type { Database } from '../database.types';

type Client = SupabaseClient<Database>;
type Fetch = (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;

const POST_IMAGES_BUCKET = 'post-images';

/** `a/b/c.jpg` → `a/b/c-thumb.jpg` (the upload convention of the app). */
export function thumbPathOf(path: string): string {
  return path.replace(/(\.[a-z0-9]+)?$/i, (ext) => `-thumb${ext}`);
}

/** Path of the copy of the photo at `ordinal` in a new batch of the owner. */
export function copiedPhotoPath(ownerId: string, batch: string, ordinal: number, source: string): string {
  const ext = /\.[a-z0-9]+$/i.exec(source)?.[0] ?? '.jpg';
  return `${ownerId}/${batch}/${ordinal}${ext}`;
}

async function copyObject(client: Client, fetchFn: Fetch, from: string, to: string, contentType: string): Promise<boolean> {
  const bucket = client.storage.from(POST_IMAGES_BUCKET);
  const response = await fetchFn(bucket.getPublicUrl(from).data.publicUrl);
  if (!response.ok) return false;
  const { error } = await bucket.upload(to, await response.arrayBuffer(), { contentType, upsert: false });
  return !error;
}

/** Copies the owner's photos for a new post; returns the copies, in order, that succeeded. */
export async function copyPostPhotos(
  client: Client,
  ownerId: string,
  photos: readonly MediaAsset[],
  batch: string,
  fetchFn: Fetch = (url) => fetch(url),
): Promise<MediaAssetInput[]> {
  const copies: MediaAssetInput[] = [];
  for (const photo of photos) {
    if (photo.bucket !== POST_IMAGES_BUCKET || !photo.path.startsWith(`${ownerId}/`)) continue;
    const path = copiedPhotoPath(ownerId, batch, copies.length, photo.path);
    try {
      if (!(await copyObject(client, fetchFn, photo.path, path, photo.mimeType))) continue;
      // The thumbnail is best effort, as on upload: the full image renders without it.
      await copyObject(client, fetchFn, thumbPathOf(photo.path), thumbPathOf(path), photo.mimeType).catch(() => false);
    } catch {
      continue;
    }
    copies.push({ path, mimeType: photo.mimeType, sizeBytes: photo.sizeBytes });
  }
  return copies;
}
