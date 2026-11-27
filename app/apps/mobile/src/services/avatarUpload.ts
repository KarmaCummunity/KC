// ─────────────────────────────────────────────
// Avatar pick + upload pipeline (FR-AUTH-011).
// Pick (camera|gallery) → square center-crop → resize up to 1024 + JPEG q=0.85
// → upload to `avatars` bucket at a NEW <userId>/avatar-<uuid>.jpg per attempt
// → return its public URL. Never a fixed path: an older upload that times out
// and lands late writes only its own, never-referenced object, so it can not
// overwrite a newer avatar. PERF-4: also writes a 96px square thumb as the
// `-thumb` sibling, with immutable cache headers on both (safe: a path is
// never rewritten). Renderers pick the thumb via deriveThumbUrl.
// ─────────────────────────────────────────────

import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { blockedPick, ensureMediaPermission, type MediaPickResult } from '../lib/mediaPermissions';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { getSupabaseClient } from '@kc/infrastructure-supabase';
import { deriveThumbPath } from '../lib/imageUrl';
import type { PickedImage } from './imageUpload';
import { encodeJpeg, planMaxEdgeResize, type EncodedJpeg } from './imageEncoding';
import { uploadErrorMessage, uploadStorageObject } from './storageObjectUpload';
import { avatarPathFromUrl } from './avatarLifecycle';

export { avatarPathFromUrl };

const AVATAR_FULL_EDGE = 1024;
// Storage avatars bucket cap, unchanged. Inspect encoded bytes, never picker metadata.
const AVATAR_MAX_BYTES = 524288;
const AVATAR_THUMB_EDGE = 96;
const COMPRESS = 0.85;
const THUMB_COMPRESS = 0.75;
const AVATAR_BUCKET = 'avatars';
/** A fresh object per upload attempt. */
const AVATAR_GENERATION_PATH = (userId: string) => `${userId}/avatar-${Crypto.randomUUID()}.jpg`;
/** The fixed paths written before per-upload paths; still removed on "remove avatar". */
const LEGACY_AVATAR_PATHS = (userId: string) => [`${userId}/avatar.jpg`, `${userId}/avatar-thumb.jpg`];
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export type AvatarSource = 'camera' | 'gallery';

/** Camera capture is mobile-only; web users are gallery-only. */
export const isCameraAvailable = Platform.OS !== 'web';

/**
 * FR-AUTH-011 AC1: pick a single image from the camera or the gallery.
 * A cancellation or a fresh denial is silent (no alert, no Settings redirect).
 * `blocked` means the user tapped again after the OS will no longer prompt.
 *
 * Note: we deliberately do NOT pass `allowsEditing` / `aspect` — on iOS 14+
 * the new PHPickerViewController doesn't support them, and combining them
 * with `aspect: [1,1]` crashes the app on the simulator (iOS 26). We do the
 * square center-crop ourselves in `resizeAndUploadAvatar` via ImageManipulator.
 */
export async function pickAvatarImage(source: AvatarSource): Promise<MediaPickResult<PickedImage>> {
  const mediaTypes = ['images'] as ImagePicker.MediaType[]; // SDK 54 array form
  const kind = source === 'camera' ? 'camera' : 'mediaLibrary';
  if (source === 'camera' && !isCameraAvailable) return { status: 'cancelled' };

  const permission = await ensureMediaPermission(kind);
  if (permission === 'blocked') return blockedPick(kind);
  if (permission !== 'granted') return { status: 'denied' };

  const r = source === 'camera'
    ? await ImagePicker.launchCameraAsync({ mediaTypes, quality: 1, exif: false })
    : await ImagePicker.launchImageLibraryAsync({
      mediaTypes, allowsMultipleSelection: false, quality: 1, exif: false,
    });
  if (r.canceled) return { status: 'cancelled' };
  const a = r.assets[0]!;
  return { status: 'ok', value: { uri: a.uri, width: a.width, height: a.height, fileSize: a.fileSize ?? null } };
}

/** Square center-crop, q85; reduce dimensions only when the encoded JPEG exceeds Storage's cap. */
async function squareCropAndResize(picked: PickedImage, size: number, compress: number): Promise<EncodedJpeg> {
  if (![picked.width, picked.height].every((n) => Number.isFinite(n) && n >= 1)) {
    throw new Error(i18n.t('profile.avatarUploadRetry'));
  }
  const side = Math.floor(Math.min(picked.width, picked.height));
  const originX = Math.max(0, Math.floor((picked.width - side) / 2));
  const originY = Math.max(0, Math.floor((picked.height - side) / 2));
  // Finite attempts, all at q85. Never upscale or re-compress a previous lossy derivative.
  const edges = [...new Set([size, 768, 512, 384, 256].map((edge) => Math.min(side, edge)))];
  for (const edge of edges) {
    const actions: ImageManipulator.Action[] = [
      { crop: { originX, originY, width: side, height: side } },
      { resize: { width: edge, height: edge } },
    ];
    const encoded = await encodeJpeg(picked.uri, actions, compress);
    if (encoded.bytes.byteLength <= AVATAR_MAX_BYTES) return encoded;
  }
  throw new Error(i18n.t('profile.avatarUploadRetry'));
}

/** Stores one avatar object; resolves with the path Storage confirmed. */
function uploadAvatarObject(
  pathForAttempt: (attempt: number) => string,
  bytes: Uint8Array,
  opts: { attempts?: number; signal?: AbortSignal } = {},
) {
  return uploadStorageObject({
    bucket: AVATAR_BUCKET,
    pathForAttempt,
    bytes,
    contentType: 'image/jpeg',
    cacheControl: IMMUTABLE_CACHE_CONTROL,
    attempts: opts.attempts,
    signal: opts.signal,
  });
}

/**
 * FR-AUTH-011 AC2: square center-crop → at most 1024×1024 q85 JPEG → upload to a new
 * `avatars/<userId>/avatar-<uuid>.jpg`. PERF-4: also writes a 96×96 thumb as its
 * `-thumb` sibling, derived from the accepted full encode. Returns the public URL;
 * being a new path it needs no cache-busting.
 */
export async function resizeAndUploadAvatar(
  picked: PickedImage,
  userId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<string> {
  if (!userId) throw new Error('resizeAndUploadAvatar: userId is required');
  const full = await squareCropAndResize(picked, AVATAR_FULL_EDGE, COMPRESS);
  const thumb = await encodeJpeg(full.uri, planMaxEdgeResize(full, AVATAR_THUMB_EDGE), THUMB_COMPRESS);

  let path: string;
  try {
    path = await uploadAvatarObject(() => AVATAR_GENERATION_PATH(userId), full.bytes, { signal: opts.signal });
  } catch (err) {
    throw new Error(`avatar_upload: ${uploadErrorMessage(err)}`, { cause: err });
  }
  // The thumb's name is fixed by `path`: one attempt, never retried at the same name. If it fails
  // the full image still renders (KCImage's `fallbackUri` covers the missing thumb).
  try {
    await uploadAvatarObject(() => deriveThumbPath(path), thumb.bytes, { attempts: 1, signal: opts.signal });
  } catch (err) {
    console.warn(`avatar_upload_thumb: ${uploadErrorMessage(err)}`);
  }

  return getSupabaseClient().storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * TD-108: delete the Storage objects before persisting `avatar_url = null`: the
 * avatar `avatarUrl` points to and its thumb, plus the legacy fixed-path pair.
 * Best-effort — Storage failures are logged and swallowed so the user-visible
 * "avatar gone" action still succeeds; the metadata wipe is the source of truth.
 */
export async function removeUploadedAvatar(userId: string, avatarUrl?: string | null): Promise<void> {
  if (!userId) return;
  const current = avatarPathFromUrl(avatarUrl, userId);
  const paths = [...LEGACY_AVATAR_PATHS(userId), ...(current ? [current, deriveThumbPath(current)] : [])];
  const { error } = await getSupabaseClient().storage.from(AVATAR_BUCKET).remove([...new Set(paths)]);
  if (error) console.warn(`avatar_remove: ${error.message}`);
}
