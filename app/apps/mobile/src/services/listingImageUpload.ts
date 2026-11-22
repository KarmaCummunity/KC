// Listing photos (marketplace worlds). A listing is a post: its photos live in the post bucket,
// under the owner's folder, and go through the same pipeline as post photos (longer edge ≤ 2048,
// a 400 px thumb for feed cards, bounded parallel uploads with time budgets and retries).

import { getSupabaseClient } from '@kc/infrastructure-supabase';
import type { MediaAssetInput } from '@kc/application';
import { pickPostImages, uploadPostImageBatch, type PickedImage } from './imageUpload';

export type { PickedImage };

const LISTING_BUCKET = 'post-images';
const MAX_LISTING_IMAGES = 5;

export { pickPostImages as pickListingImages };

/** Uploads the photos in order; rejects with the first failure (the listing form retries as a whole). */
export async function uploadListingImages(
  userId: string,
  picked: PickedImage[],
): Promise<MediaAssetInput[]> {
  const results = await uploadPostImageBatch(picked.slice(0, MAX_LISTING_IMAGES), userId);
  const failure = results.find((r) => r.status === 'rejected');
  if (failure) {
    const reason = failure.reason as { message?: unknown } | null;
    throw new Error(typeof reason?.message === 'string' ? reason.message : String(failure.reason));
  }
  // The bytes actually stored: `post_media` records the real size and type of each file.
  return results.map((r) => {
    const { path, mimeType, sizeBytes } = (r as PromiseFulfilledResult<MediaAssetInput>).value;
    return { path, mimeType, sizeBytes };
  });
}

export function listingImagePublicUrl(storagePath: string): string {
  const client = getSupabaseClient();
  return client.storage.from(LISTING_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}
