// Picks the image a link-preview card shows (og:image) and describes it (type, width, height).
//
// FAIL CLOSED. A candidate (the cover object, then its `-thumb` sibling) is used only when the
// probe could check ALL of it: the server declared its size up front (Content-Length), the size
// is within OG_IMAGE_MAX_BYTES, exactly that many bytes arrived, the bytes really are a JPEG or a
// PNG, and a walk over every JPEG marker / PNG chunk reached the end marker without meeting a
// segment that can carry metadata (EXIF and XMP live in APP1, IPTC in APP13, free text in COM;
// PNG keeps EXIF in eXIf and text in tEXt/zTXt/iTXt). Anything indeterminate (unknown size,
// partial or truncated answer, unknown segment, malformed structure) rejects the candidate. A
// client-made thumb is not trusted either: it is checked the same way. With no qualifying
// candidate the card shows the community logo. A metadata-free file is not proof of a safe image
// in every other respect; the share card only names files of public posts (post_share_card).
//
// Size: crawlers such as WhatsApp silently drop heavy preview images (third-party reports put the
// practical limit near 300 KB; Meta documents none), so 300 KB is also the download cap here.

import { trimTrailingSlashes } from './config.mjs';

/** The only bucket a post image may live in (the baseline's single public media bucket). */
const IMAGE_BUCKET = 'post-images';
/** The community logo, used when the post has no usable image. Measured: 512×512 PNG, 162 KB. */
export const FALLBACK_IMAGE = { path: '/pwa-icon-512.png', type: 'image/png', width: 512, height: 512 };
/** Heaviest preview image we serve. */
export const OG_IMAGE_MAX_BYTES = 300 * 1024;
/** Narrower images get no large preview on most crawlers. */
export const OG_IMAGE_MIN_WIDTH = 200;
const PROBE_TIMEOUT_MS = 1500;

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

/**
 * JPEG segments a preview may contain, an allow-list: frame headers (SOFn), Huffman / arithmetic /
 * quantization tables (DHT, DAC, DQT), restart interval and line count (DRI, DNL), the scan (SOS),
 * and JFIF (APP0), ICC (APP2), Adobe (APP14). Every other marker rejects the file.
 */
const JPEG_ALLOWED_SEGMENTS = new Set([0xc4, 0xcc, 0xdb, 0xda, 0xdc, 0xdd, 0xe0, 0xe2, 0xee]);
/** PNG chunks that carry pixels or colour information only; every other chunk rejects the file. */
const PNG_ALLOWED_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs']);

const isFrameMarker = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
const isRestartMarker = (m) => m >= 0xd0 && m <= 0xd7;

/** After an SOS header: skips entropy-coded data (stuffed FF00 and restart markers) to the next marker. */
function skipEntropyData(bytes, from) {
  let i = from;
  while (i + 1 < bytes.length) {
    if (bytes[i] === 0xff && bytes[i + 1] !== 0x00 && !isRestartMarker(bytes[i + 1]) && bytes[i + 1] !== 0xff) return i;
    i += 1;
  }
  return -1;
}

/**
 * Walks a whole JPEG from SOI to EOI. Returns its frame size when every segment is allowed, the
 * structure is complete and EOI is the file's last two bytes; null for anything else (metadata or
 * unknown segment, malformed, truncated, no frame, bytes after EOI).
 */
export function verifyJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  let size = null;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte before a marker
    if (marker === 0xd9) return i + 2 === bytes.length ? size : null; // EOI must be the last bytes
    if (isRestartMarker(marker) || marker === 0x01) { i += 2; continue; }
    if (i + 3 >= bytes.length) return null;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2 || i + 2 + length > bytes.length) return null;
    if (!isFrameMarker(marker) && !JPEG_ALLOWED_SEGMENTS.has(marker)) return null; // EXIF/XMP/IPTC/comment/unknown
    if (isFrameMarker(marker)) {
      if (length < 8) return null;
      size = { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + length;
    if (marker === 0xda) {
      i = skipEntropyData(bytes, i);
      if (i < 0) return null;
    }
  }
  return null; // ran out of bytes before EOI
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Walks every PNG chunk to IEND. Returns the IHDR size when all chunks are allowed and an empty
 * IEND ends the file exactly; null otherwise.
 */
export function verifyPng(bytes) {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 8;
  let size = null;
  while (i + 8 <= bytes.length) {
    const length = view.getUint32(i);
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const end = i + 12 + length; // length, type, data, CRC
    if (end > bytes.length || !PNG_ALLOWED_CHUNKS.has(type)) return null;
    if (type === 'IHDR') {
      if (length !== 13) return null;
      size = { width: view.getUint32(i + 8), height: view.getUint32(i + 12) };
    }
    if (type === 'IEND') return length === 0 && end === bytes.length ? size : null;
    i = end;
  }
  return null; // no IEND
}

/** What the complete file is, when it qualifies as a preview image; null otherwise. */
export function verifyImage(bytes) {
  const jpeg = verifyJpeg(bytes);
  if (jpeg) return { type: 'image/jpeg', ...jpeg };
  const png = verifyPng(bytes);
  if (png) return { type: 'image/png', ...png };
  return null;
}

/** The declared body size, or null when the server did not declare one. */
function declaredLength(response) {
  const raw = response.headers.get('content-length');
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Reads the whole body, refusing to read past `limit`; null when it overflows. */
async function readAll(response, limit) {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > limit ? null : bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * @returns {Promise<OgImage | null>} the image when it qualifies (see the header); null for
 *          anything else, including every indeterminate case. Never throws.
 */
export async function probeImage(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    // Only a complete answer can be checked completely: a 206 range is a partial file.
    if (response.status !== 200) return null;
    const declared = declaredLength(response);
    if (declared === null || declared > OG_IMAGE_MAX_BYTES) return null;
    const bytes = await readAll(response, declared);
    if (!bytes || bytes.length !== declared) return null;
    const image = verifyImage(bytes);
    if (!image || image.width < OG_IMAGE_MIN_WIDTH || image.height < 1) return null;
    return { url, type: image.type, width: image.width, height: image.height };
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
