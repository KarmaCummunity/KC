// ─────────────────────────────────────────────
// Post-image pick + upload pipeline (FR-POST-005).
// Gallery → longer edge ≤ 2048 + JPEG q=0.85 → post-images bucket.
// PERF-4: also generates a 400px thumb at upload time (sibling
// `<batchUuid>/<ordinal>-thumb.jpg`), derived from the 2048 encode so the
// original is decoded only once. Both objects are uploaded with
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
import * as Crypto from 'expo-crypto';
import type { MediaAssetInput } from '@kc/application';
import { MAX_MEDIA_ASSETS } from '@kc/domain';
import { deriveThumbPath } from '../lib/imageUrl';
import { encodeJpeg, planMaxEdgeResize, type EncodedJpeg } from './imageEncoding';
import { uploadErrorMessage, uploadStorageObject } from './storageObjectUpload';
import { isUploadCancelled, mapSettledWithConcurrency, throwIfAborted } from './uploadControl';

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
  /** Tried when `previewUri` fails (an already-stored photo whose small thumb is missing). */
  previewFallbackUri?: string;
}

/**
 * If permission was already permanently denied before this attempt, surface an
 * actionable alert that opens iOS / Android Settings. Returns true when the
 * caller may proceed.
 */
async function ensureMediaLibraryPermission(): Promise<boolean> {
  const before = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (before.granted) return true;
  // A denial in this attempt is final: never follow the OS sheet with persuasion.
  // Settings recovery is reserved for a later, explicit use of this feature.
  if (before.canAskAgain !== false) {
    const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return result.granted;
  }
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

/** Full image: the longer edge bounded at 2048 px, re-encoded at q=0.85 (FR-POST-005 AC3). */
async function encodeFullImage(picked: PickedImage): Promise<EncodedJpeg> {
  const full = await encodeJpeg(picked.uri, planMaxEdgeResize(picked, POST_RESIZE_MAX_EDGE), COMPRESS);
  if (full.bytes.byteLength <= POST_MAX_BYTES) return full;
  // Too heavy (e.g. a noisy 50 MP photo): re-encode the already-resized file at a lower quality,
  // which is far cheaper than decoding the original again.
  const smaller = await encodeJpeg(full.uri, [], POST_FALLBACK_COMPRESS);
  if (smaller.bytes.byteLength > POST_MAX_BYTES) {
    throw new Error(`image_resize: too large after fallback compress (${smaller.bytes.byteLength} > ${POST_MAX_BYTES})`);
  }
  return smaller;
}

export interface UploadOptions {
  /** Aborts the remaining work (screen closed, user tapped cancel). */
  readonly signal?: AbortSignal;
}

/**
 * Resize, upload, and return the MediaAssetInput shape expected by CreatePostInput.
 * Throws if the full image cannot be stored so the caller can offer a retry (FR-POST-005 AC5).
 *
 * The original is decoded once: the thumb is derived from the 2048 px encode, not from the
 * (up to 50 MP) original. Both objects upload in parallel; each upload has a time budget and
 * retries transient failures (`storageObjectUpload.ts`).
 */
export async function resizeAndUploadImage(
  picked: PickedImage,
  userId: string,
  batchUuid: string,
  ordinal: number,
  opts: UploadOptions = {},
): Promise<UploadedAsset> {
  const basePath = buildPostImagePath(userId, batchUuid, ordinal);
  throwIfAborted(opts.signal);
  const full = await encodeFullImage(picked);
  throwIfAborted(opts.signal);
  const thumb = await encodeJpeg(full.uri, planMaxEdgeResize(full, POST_THUMB_MAX_EDGE), THUMB_COMPRESS);
  throwIfAborted(opts.signal);

  // upsert stays false: the post-images bucket has an INSERT policy only (a member writes under their
  // own folder, 30_social/900_storage.sql). Each attempt writes its own path (`<n>.jpg`, then
  // `<n>-a2.jpg`, ...), so a write that lands after its attempt was aborted is never referenced.
  const upload = (pathForAttempt: (attempt: number) => string, bytes: Uint8Array, attempts?: number) =>
    uploadStorageObject({
      bucket: POST_BUCKET,
      pathForAttempt,
      bytes,
      contentType: 'image/jpeg',
      cacheControl: IMMUTABLE_CACHE_CONTROL,
      signal: opts.signal,
      attempts,
    });
  let path: string;
  try {
    path = await upload((attempt) => buildAttemptPath(basePath, attempt), full.bytes);
  } catch (err) {
    if (isUploadCancelled(err)) throw err;
    throw new Error(`upload[${ordinal}]: ${uploadErrorMessage(err)}`, { cause: err });
  }
  // The thumb is the stored photo's `-thumb` sibling, so its name is fixed by `path`: one attempt
  // only, never retried at the same name. If it fails the photo still renders (KCImage falls back
  // to the full image).
  try {
    await upload(() => deriveThumbPath(path), thumb.bytes, 1);
  } catch (err) {
    if (isUploadCancelled(err)) throw err;
    console.warn(`upload-thumb[${ordinal}]: ${uploadErrorMessage(err)}`);
  }

  return {
    path,
    mimeType: 'image/jpeg',
    sizeBytes: full.bytes.byteLength,
    previewUri: picked.uri,
  };
}

/** Path of upload attempt `n` of an object: the first keeps `base`, later ones add `-a<n>` before the extension. */
export function buildAttemptPath(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const dot = base.lastIndexOf('.');
  const slash = base.lastIndexOf('/');
  return dot > slash ? `${base.slice(0, dot)}-a${attempt}${base.slice(dot)}` : `${base}-a${attempt}`;
}

/** At most two images are encoded and uploaded at once: parallel enough to hide network latency,
 *  low enough that two full-size decodes never compete for memory on a low-end phone. */
const POST_UPLOAD_CONCURRENCY = 2;

/**
 * Uploads one pick of images under a fresh batch folder, so ordinals never collide with an
 * earlier pick (even after photos were removed, or while another pick is still uploading).
 * Every image settles independently (FR-POST-005 AC5); results keep the pick order.
 */
export function uploadPostImageBatch(
  picked: readonly PickedImage[],
  userId: string,
  opts: UploadOptions & { onSettled?: (index: number, result: PromiseSettledResult<UploadedAsset>) => void } = {},
): Promise<PromiseSettledResult<UploadedAsset>[]> {
  const batchUuid = newUploadBatchId();
  return mapSettledWithConcurrency(
    picked,
    POST_UPLOAD_CONCURRENCY,
    (image, ordinal) => resizeAndUploadImage(image, userId, batchUuid, ordinal, { signal: opts.signal }),
    { signal: opts.signal, onSettled: opts.onSettled },
  );
}

/** Generate a per-create-action UUID for the storage folder. */
export function newUploadBatchId(): string {
  return Crypto.randomUUID();
}
