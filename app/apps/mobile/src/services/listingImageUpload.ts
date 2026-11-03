import * as Crypto from 'expo-crypto';
import { getSupabaseClient } from '@kc/infrastructure-supabase';
import { buildPostImagePath, pickPostImages, type PickedImage } from './imageUpload';

export type { PickedImage };
import * as ImageManipulator from 'expo-image-manipulator';
import { base64ToUint8Array } from './mediaEncoding';

const LISTING_BUCKET = 'listing-images';
const MAX_LISTING_IMAGES = 5;
const MAX_EDGE = 2048;
const COMPRESS = 0.85;
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export { pickPostImages as pickListingImages };

async function encodeJpeg(uri: string): Promise<Uint8Array> {
  const r = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_EDGE } }],
    { compress: COMPRESS, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!r.base64) throw new Error('listing_image: no base64');
  return base64ToUint8Array(r.base64);
}

export async function uploadListingImages(
  userId: string,
  picked: PickedImage[],
): Promise<string[]> {
  const batch = Crypto.randomUUID();
  const client = getSupabaseClient();
  const paths: string[] = [];
  const slice = picked.slice(0, MAX_LISTING_IMAGES);
  for (let i = 0; i < slice.length; i += 1) {
    const path = buildPostImagePath(userId, batch, i);
    const bytes = await encodeJpeg(slice[i]!.uri);
    const { error } = await client.storage.from(LISTING_BUCKET).upload(path, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    });
    if (error) throw new Error(error.message);
    paths.push(path);
  }
  return paths;
}

export function listingImagePublicUrl(storagePath: string): string {
  const client = getSupabaseClient();
  return client.storage.from(LISTING_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}
