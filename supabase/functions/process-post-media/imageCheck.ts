// process-post-media · what an uploaded file really is, read from its bytes before any decode.
//
// The declared MIME type and the file name are the uploader's claims. This module trusts only
// the bytes: the JPEG or PNG signature, then the frame header (JPEG SOFn) or IHDR (PNG) for the
// pixel size. Decoding allocates width × height × 4 bytes, so the size is capped HERE, before a
// decoder ever sees the file: a few-KB file that declares 30000 × 30000 px (a decompression bomb)
// is rejected without being decoded. SVG, HTML or anything else labelled as an image has no
// signature and is rejected too.

/** Largest accepted source edge. The app uploads ≤ 2048 px; WhatsApp "HD" photos are ≤ 4096 px. */
export const MAX_SOURCE_EDGE = 4096;
/** Largest accepted source area: 16.8 MP ≈ 67 MB of RGBA once decoded (assumed to fit the worker; not measured on Supabase). */
export const MAX_SOURCE_PIXELS = 4096 * 4096;
/** The bucket's own per-object limit (`post-images`, 8 MiB). */
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export type ImageType = 'image/jpeg' | 'image/png';

export interface ImageInfo {
  readonly type: ImageType;
  readonly width: number;
  readonly height: number;
}

/** A file the worker refuses for what it is (never retried). `code` is recorded on the job. */
export class ImageRejected extends Error {
  constructor(readonly code: 'not_an_image' | 'no_dimensions' | 'too_many_pixels' | 'too_large') {
    super(code);
    this.name = 'ImageRejected';
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The type the signature says, or null. */
export function sniffType(bytes: Uint8Array): ImageType | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return 'image/png';
  return null;
}

/** Frame size of a JPEG, walking its segments from SOI to the first SOFn; null if not reachable. */
export function jpegFrameSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // image data before any frame header
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2 || i + 2 + length > bytes.length) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (length < 8) return null;
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + length;
  }
  return null;
}

/** IHDR size of a PNG (always the first chunk); null if malformed. */
export function pngHeaderSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (type !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Accepts a JPEG or PNG within the byte and pixel caps; throws ImageRejected otherwise. */
export function inspectImage(bytes: Uint8Array): ImageInfo {
  if (bytes.length > MAX_SOURCE_BYTES) throw new ImageRejected('too_large');
  const type = sniffType(bytes);
  if (!type) throw new ImageRejected('not_an_image');
  const size = type === 'image/jpeg' ? jpegFrameSize(bytes) : pngHeaderSize(bytes);
  if (!size || size.width < 1 || size.height < 1) throw new ImageRejected('no_dimensions');
  if (size.width > MAX_SOURCE_EDGE || size.height > MAX_SOURCE_EDGE || size.width * size.height > MAX_SOURCE_PIXELS) {
    throw new ImageRejected('too_many_pixels');
  }
  return { type, ...size };
}

/**
 * Fail-closed check of a JPEG this worker produced: true only when the header walk reaches the
 * first scan (SOS) and met no segment that can carry metadata (APP1 EXIF/XMP, APP13 IPTC, COM,
 * or any APPn other than JFIF APP0 / ICC APP2 / Adobe APP14). A walk that cannot complete is
 * "not clean".
 */
export function jpegHeaderIsClean(bytes: Uint8Array): boolean {
  if (sniffType(bytes) !== 'image/jpeg') return false;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return false;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xda) return true; // header complete: what follows is image data
    if (marker === 0xd9) return false;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if ((isApp && marker !== 0xe0 && marker !== 0xe2 && marker !== 0xee) || marker === 0xfe) return false;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2 || i + 2 + length > bytes.length) return false;
    i += 2 + length;
  }
  return false;
}
