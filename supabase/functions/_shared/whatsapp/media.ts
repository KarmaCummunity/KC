// Downloading a photo a member sent in WhatsApp (D158 as approved): Graph API media lookup,
// then the bytes, checked against the post photo limits before anything is stored.
// `GET /{media-id}` returns a short-lived URL (about five minutes) that needs the same bearer
// token. fetch is injectable for tests; the token is never logged or returned.

import type { FetchFn } from './meta.ts';

/** The post photo limits of the server (`post-images` bucket, post_media_image_chk, FR-POST-005). */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_TYPES: Record<string, 'jpg' | 'png'> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

export type GraphConfig = { token: string; graphVersion?: string; baseUrl?: string };
export type Photo = { bytes: Uint8Array; mimeType: string; ext: 'jpg' | 'png' };
export type DownloadResult =
  | { ok: true; photo: Photo }
  | { ok: false; reason: 'invalid_photo' | 'download_failed'; detail: string };

/** A MIME type (parameters dropped, lower case) the post photos accept, or null. */
export function photoType(mime: unknown): string | null {
  const base = String(mime ?? '').split(';')[0].trim().toLowerCase();
  return base in PHOTO_TYPES ? base : null;
}

/** The type the bytes really are (JPEG or PNG magic), or null. */
export function sniffPhotoType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) return 'image/png';
  return null;
}

const invalid = (detail: string): DownloadResult => ({ ok: false, reason: 'invalid_photo', detail });
const failed = (detail: string): DownloadResult => ({ ok: false, reason: 'download_failed', detail });

async function lookup(cfg: GraphConfig, mediaId: string, fetchFn: FetchFn) {
  const base = cfg.baseUrl ?? 'https://graph.facebook.com';
  const url = `${base}/${cfg.graphVersion || 'v21.0'}/${encodeURIComponent(mediaId)}`;
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${cfg.token}` } });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as { url?: string; mime_type?: string; file_size?: number } | null;
}

/** Fetches the photo of a media id; refuses anything but a JPEG or PNG of at most 8 MB. */
export async function downloadPhoto(cfg: GraphConfig, mediaId: string, fetchFn: FetchFn): Promise<DownloadResult> {
  if (!cfg.token) return failed('no_token');
  if (!mediaId) return invalid('no_media_id');
  try {
    const meta = await lookup(cfg, mediaId, fetchFn);
    if (!meta?.url) return failed('lookup');
    if (!photoType(meta.mime_type)) return invalid('type');
    if (typeof meta.file_size === 'number' && meta.file_size > PHOTO_MAX_BYTES) return invalid('size');

    const res = await fetchFn(meta.url, { headers: { Authorization: `Bearer ${cfg.token}` } });
    if (!res.ok) return failed(`HTTP ${res.status}`);
    if (Number(res.headers.get('content-length') ?? 0) > PHOTO_MAX_BYTES) return invalid('size');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES) return invalid('size');
    // The bytes decide, not the label: a file named JPEG must be one.
    const mimeType = sniffPhotoType(bytes);
    if (!mimeType) return invalid('type');
    return { ok: true, photo: { bytes, mimeType, ext: PHOTO_TYPES[mimeType] } };
  } catch (e) {
    return failed(`network: ${e instanceof Error ? e.message : String(e)}`);
  }
}
