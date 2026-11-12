// ─────────────────────────────────────────────
// Post-image pick + upload pipeline (FR-POST-005).
// Gallery → resize-2048 + JPEG q=0.85 → post-images bucket.
// PERF-4: also generates a 400px thumb at upload time (sibling
// `<batchUuid>/<ordinal>-thumb.jpg`). Both objects are uploaded with
// `cache-control: public, max-age=31536000, immutable` — paths are unique
// per upload, so the bucket can be safely cached forever.
// AC4 EXIF strip is best-effort (re-encode) until the server-side Edge
// Function lands per TD-23.
// Avatar pipeline lives in ./avatarUpload.ts.
// ─────────────────────────────────────────────

import { Linking } from 'react-native';
import i18n from '../i18n';
import { confirmAction } from './platformConfirm';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { getSupabaseClient } from '@kc/infrastructure-supabase';
import type { MediaAssetInput } from '@kc/application';
import { MAX_MEDIA_ASSETS } from '@kc/domain';
import { base64ToUint8Array } from './mediaEncoding';
import { deriveThumbPath } from '../lib/imageUrl';

const POST_RESIZE_MAX_EDGE = 2048;
const POST_THUMB_MAX_EDGE = 400;
const COMPRESS = 0.85; // JPEG quality (FR-POST-005 AC3)
const THUMB_COMPRESS = 0.75; // smaller surfaces tolerate a touch more compression
// Audit §4.8 — cap the post-resize byte budget so a 50MP camera at q=0.85
// can't produce a >5 MB JPEG that chews cellular bandwidth + Storage quota.
// If the first encode is too big, fall back to q=0.6; reject if still over.
const POST_MAX_BYTES = 5 * 1024 * 1024;
const POST_FALLBACK_COMPRESS = 0.6;
const POST_BUCKET = 'post-images';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
  fileSize: number | null; // ImagePicker reports null on web
}

export interface UploadedAsset extends MediaAssetInput {
  /** Local URI returned by the picker — use to render a preview before publish. */
  previewUri: string;
}

/**
 * If permission is permanently denied (`canAskAgain === false`), surface an
 * actionable alert that opens iOS / Android Settings. Returns true when the
 * caller may proceed.
 */
async function ensureMediaLibraryPermission(): Promise<boolean> {
  const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (result.granted) return true;
  if (result.canAskAgain) return false;
  const openSettings = await confirmAction(
    i18n.t('errors.media.galleryDeniedTitle'),
    i18n.t('errors.media.galleryDeniedBodyPost'),
    { confirmLabel: i18n.t('errors.media.openSettings') },
  );
  if (openSettings) void Linking.openSettings();
  return false;
}

/**
 * FR-POST-005 AC2: picks up to (MAX - already) images from the gallery.
 * Returns [] if the user cancels or denies permission.
 */
export async function pickPostImages(alreadyPicked: number): Promise<PickedImage[]> {
  const remaining = Math.max(0, MAX_MEDIA_ASSETS - alreadyPicked);
  if (remaining === 0) return [];

  if (!(await ensureMediaLibraryPermission())) return [];

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'] as ImagePicker.MediaType[], // SDK 54 array form
    allowsMultipleSelection: true,
    selectionLimit: remaining,
    quality: 1,
    exif: false, // ask the picker not to include EXIF; not all platforms honor it
  });
  if (result.canceled) return [];

  return result.assets.map((a) => ({
    uri: a.uri,
    width: a.width,
    height: a.height,
    fileSize: a.fileSize ?? null,
  }));
}

/**
 * Build the storage path for an upload.
 * Format: <userId>/<batchUuid>/<ordinal>.jpg
 * The RLS Storage policy `post_images_insert_own` requires the first folder
 * segment to equal auth.uid() (see 0002_init_posts.sql:294-298).
 */
export function buildPostImagePath(userId: string, batchUuid: string, ordinal: number): string {
  if (!userId) throw new Error('buildPostImagePath: userId is required');
  if (!batchUuid) throw new Error('buildPostImagePath: batchUuid is required');
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 4)
    throw new Error('buildPostImagePath: ordinal must be 0..4');
  return `${userId}/${batchUuid}/${ordinal}.jpg`;
}

/**
 * Sibling thumb path for a built post image path.
 * The RLS Storage policy keys on the first folder segment (= auth.uid()), so
 * the same upload policy covers both the full and the thumb object.
 */
export function buildPostImageThumbPath(userId: string, batchUuid: string, ordinal: number): string {
  return deriveThumbPath(buildPostImagePath(userId, batchUuid, ordinal));
}

/**
 * Resize the image to a max-edge size, JPEG-encode, and return raw bytes.
 * `capBytes` (only for the full encode) re-runs once at a lower quality if the
 * first pass is too large, and throws if still over — protects cellular users
 * from a 5 MB JPEG. The thumb encode never needs this guard.
 * fetch(file://).blob() is unreliable on iOS — see `mediaEncoding.ts` for context.
 */
async function resizeImage(
  uri: string,
  maxEdge: number,
  opts: { compress: number; capBytes?: number; fallbackCompress?: number },
): Promise<{ bytes: Uint8Array; sizeBytes: number }> {
  const encode = async (compress: number) => {
    const r = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: maxEdge } }],
      { compress, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    if (!r.base64) throw new Error('image_resize: manipulator returned no base64 payload');
    return base64ToUint8Array(r.base64);
  };
  let bytes = await encode(opts.compress);
  if (opts.capBytes != null && bytes.byteLength > opts.capBytes) {
    if (opts.fallbackCompress == null) {
      throw new Error(`image_resize: too large (${bytes.byteLength} > ${opts.capBytes})`);
    }
    bytes = await encode(opts.fallbackCompress);
    if (bytes.byteLength > opts.capBytes) {
      throw new Error(`image_resize: too large after fallback compress (${bytes.byteLength} > ${opts.capBytes})`);
    }
  }
  return { bytes, sizeBytes: bytes.byteLength };
}

/**
 * Resize, upload, and return the MediaAssetInput shape expected by CreatePostInput.
 * Throws if upload fails so the caller can show "Failed: retry" UI.
 *
 * Two encodes (full + thumb) are produced sequentially. `ImageManipulator`
 * marshals through a single native bridge — running them in parallel doesn't
 * speed it up and can spike memory on lower-end devices.
 */
export async function resizeAndUploadImage(
  picked: PickedImage,
  userId: string,
  batchUuid: string,
  ordinal: number,
): Promise<UploadedAsset> {
  const full = await resizeImage(picked.uri, POST_RESIZE_MAX_EDGE, {
    compress: COMPRESS,
    capBytes: POST_MAX_BYTES,
    fallbackCompress: POST_FALLBACK_COMPRESS,
  });
  const thumb = await resizeImage(picked.uri, POST_THUMB_MAX_EDGE, {
    compress: THUMB_COMPRESS,
  });

  const path = buildPostImagePath(userId, batchUuid, ordinal);
  const thumbPath = buildPostImageThumbPath(userId, batchUuid, ordinal);

  // upsert stays false: the post-images bucket has an INSERT policy only (a member writes under their
  // own folder, 30_social/900_storage.sql); storage's upsert needs SELECT + UPDATE policies too and is
  // refused with "new row violates row-level security policy". The path is unique per batch anyway.
  const client = getSupabaseClient();
  const fullUpload = await client.storage
    .from(POST_BUCKET)
    .upload(path, full.bytes, {
      contentType: 'image/jpeg',
      upsert: false,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    });
  if (fullUpload.error) throw new Error(`upload[${ordinal}]: ${fullUpload.error.message}`);

  // Thumb upload is best-effort — if it fails the full image still renders
  // (KCImage's `fallbackUri` covers the missing thumb), and the daily
  // backfill Edge Function will eventually fill it in.
  const thumbUpload = await client.storage
    .from(POST_BUCKET)
    .upload(thumbPath, thumb.bytes, {
      contentType: 'image/jpeg',
      upsert: false,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    });
  if (thumbUpload.error) {
    console.warn(`upload-thumb[${ordinal}]: ${thumbUpload.error.message}`);
  }

  return {
    path,
    mimeType: 'image/jpeg',
    sizeBytes: full.sizeBytes,
    previewUri: picked.uri,
  };
}

/** Generate a per-create-action UUID for the storage folder. */
export function newUploadBatchId(): string {
  return Crypto.randomUUID();
}
