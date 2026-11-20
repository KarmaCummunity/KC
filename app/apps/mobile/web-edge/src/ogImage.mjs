// Picks the image a link-preview card shows (og:image) and describes it (type, width, height).
//
// The post's cover is uploaded twice by the app: the photo (longer edge ≤ 2048 px, often
// 300-600 KB) and a `-thumb` sibling (longer edge 400 px, ~30 KB). Crawlers such as WhatsApp
// silently drop a preview image that is too heavy or slow to fetch (third-party reports put the
// practical limit near 300 KB; Meta documents none), so the card uses the photo only when it is
// small enough, else the thumb, else the community logo. Each candidate is probed with one ranged
// GET of its first 64 KB, never a full download: the probe checks the HTTP answer, the real bytes
// (a JPEG or PNG signature, whatever the declared type says), the total size, the pixel
// dimensions, and that the header carries no EXIF block (which can hold GPS coordinates).

import { trimTrailingSlashes } from './config.mjs';

/** The only bucket a post image may live in (the baseline's single public media bucket). */
const IMAGE_BUCKET = 'post-images';
/** The community logo, used when the post has no usable image. Measured: 512×512 PNG, 162 KB. */
export const FALLBACK_IMAGE = { path: '/pwa-icon-512.png', type: 'image/png', width: 512, height: 512 };
/** Heaviest preview image we serve. */
export const OG_IMAGE_MAX_BYTES = 300 * 1024;
/** Narrower images get no large preview on most crawlers. */
export const OG_IMAGE_MIN_WIDTH = 200;
/** Bytes read per probe: enough for the JPEG header segments up to the frame header. */
const PROBE_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 1200;

/** @typedef {{ url: string, type: string, width: number | null, height: number | null }} OgImage */

/** @returns {OgImage} the logo, always available. */
export function fallbackImage(appBaseUrl) {
  const { path, ...rest } = FALLBACK_IMAGE;
  return { url: `${appBaseUrl}${path}`, ...rest };
}

/** `a/b/0.jpg` → `a/b/0-thumb.jpg` (the app's thumb naming, `lib/imageUrl.ts`). */
export function thumbKey(key) {
  const dot = key.lastIndexOf('.');
  const slash = key.lastIndexOf('/');
  return dot === -1 || dot < slash ? `${key}-thumb` : `${key.slice(0, dot)}-thumb${key.slice(dot)}`;
}

function publicObjectUrl(supabaseUrl, key) {
  const path = key.startsWith('/') ? key.slice(1) : key;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${trimTrailingSlashes(supabaseUrl)}/storage/v1/object/public/${IMAGE_BUCKET}/${encoded}`;
}

/** Public URLs of the cover photo and its thumb, best first; [] when there is no usable cover. */
export function coverCandidates({ cover_bucket: bucket, cover_key: key }, { supabaseUrl }) {
  if (!supabaseUrl || bucket !== IMAGE_BUCKET || typeof key !== 'string' || key === '') return [];
  return [publicObjectUrl(supabaseUrl, key), publicObjectUrl(supabaseUrl, thumbKey(key))];
}

/** Width and height from a JPEG frame header (SOFn), or null when not within `bytes`. */
export function jpegSize(bytes) {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

/** True when a JPEG header has an APP1 "Exif\0\0" segment (camera metadata, possibly GPS). */
export function jpegHasExif(bytes) {
  let i = 2;
  while (i + 9 < bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) return false; // image data starts: no more metadata
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69
        && bytes[i + 7] === 0x66 && bytes[i + 8] === 0 && bytes[i + 9] === 0) return true;
    i += 2 + length;
  }
  return false;
}

/** What the first bytes really are, independent of any declared content type. */
export function sniffImage(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { type: 'image/jpeg', size: jpegSize(bytes), exif: jpegHasExif(bytes) };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 24 && png.every((b, i) => bytes[i] === b)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { type: 'image/png', size: { width: view.getUint32(16), height: view.getUint32(20) }, exif: false };
  }
  return null;
}

/** Total object size from a 206 `content-range: bytes 0-N/TOTAL` or a 200 `content-length`. */
function totalBytes(response) {
  const range = response.headers.get('content-range');
  const match = range ? /\/(\d+)\s*$/.exec(range) : null;
  const raw = match ? match[1] : response.headers.get('content-length');
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Reads at most `limit` bytes of a body and abandons the rest. */
async function readHead(response, limit) {
  if (!response.body) return new Uint8Array(await response.arrayBuffer()).slice(0, limit);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (length < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(length, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, out.length - offset);
    out.set(part, offset);
    offset += part.length;
    if (offset >= out.length) break;
  }
  return out;
}

/**
 * @returns {Promise<OgImage | null>} the image when it is a real JPEG/PNG within the size budget,
 *          wide enough, without EXIF; null otherwise (missing, slow, too heavy, not an image). Never throws.
 */
export async function probeImage(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { headers: { range: `bytes=0-${PROBE_BYTES - 1}` }, signal: controller.signal });
    if (response.status !== 200 && response.status !== 206) return null;
    const total = totalBytes(response);
    if (total === null || total > OG_IMAGE_MAX_BYTES) return null;
    const sniffed = sniffImage(await readHead(response, PROBE_BYTES));
    if (!sniffed || sniffed.exif) return null;
    if (sniffed.size && sniffed.size.width < OG_IMAGE_MIN_WIDTH) return null;
    return { url, type: sniffed.type, width: sniffed.size?.width ?? null, height: sniffed.size?.height ?? null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The preview image of a share-card row: the cover, its thumb, or the logo. */
export async function selectOgImage(row, config, fetchImpl) {
  const candidates = coverCandidates(row, config);
  // Probed together so the card waits for one round trip, not two.
  const probed = await Promise.all(candidates.map((url) => probeImage(url, fetchImpl)));
  return probed.find((image) => image !== null) ?? fallbackImage(config.appBaseUrl);
}
