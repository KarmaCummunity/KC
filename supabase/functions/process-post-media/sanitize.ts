// process-post-media · turns an uploaded photo into the copy others may see, without decoding pixels.
//
// Why no re-encode: decoding and re-encoding a 2048 × 1536 photo in the Edge runtime (Jimp) measured
// ≈ 1.7 s of CPU, too close to the platform's per-request CPU limit. The app already re-encodes on
// the device; the server's job is to make sure the stored file is exactly an image and carries no
// metadata. So the file is parsed fail-closed and rebuilt from the parts an image needs:
//
//   JPEG  every segment from SOI to EOI is walked. Kept: quantization and Huffman tables, the frame
//         header (baseline, extended or progressive, 8-bit), restart interval, scans with their
//         entropy-coded data, the ICC colour profile (APP2) and Adobe's colour-transform flag
//         (APP14). Dropped: EXIF/XMP (APP1), IPTC (APP13), every other APPn, comments, a JFIF
//         thumbnail. JFIF is re-emitted without its thumbnail when the source had it (it tells
//         decoders the colour space). The EXIF orientation is carried over as a minimal APP1 with
//         that one tag, so a rotated photo still displays upright. Anything else (an unknown or
//         unsupported marker, a second frame, a truncated segment, bytes after EOI) rejects the file.
//   PNG   every chunk is walked and its CRC checked. Kept: the image chunks (IHDR, PLTE, IDAT, IEND)
//         and the rendering ones (tRNS, gAMA, cHRM, sRGB, iCCP, sBIT, bKGD, pHYs). Dropped: text
//         (tEXt, zTXt, iTXt), eXIf, tIME and every other ancillary chunk (an animated PNG keeps its
//         still default image). An unknown critical chunk, a bad CRC or bytes after IEND rejects it.
//
// The pixel size is read from the frame header / IHDR and capped (imageCheck.ts) before anything
// else is done with the file. The output is the same image data, so its size and type are the source's.

import { ImageRejected, inspectImage, MAX_SOURCE_EDGE, MAX_SOURCE_PIXELS, type ImageInfo, type SourceCaps } from './imageCheck.ts';

export interface SanitizedImage extends ImageInfo {
  readonly bytes: Uint8Array;
}

const SOURCE_CAPS: SourceCaps = { maxSourceEdge: MAX_SOURCE_EDGE, maxSourcePixels: MAX_SOURCE_PIXELS };

/** Validates and rewrites one upload; throws ImageRejected for anything that is not a clean-able image. */
export function sanitizeImage(bytes: Uint8Array, caps: SourceCaps = SOURCE_CAPS): SanitizedImage {
  const info = inspectImage(bytes, caps);
  const clean = info.type === 'image/jpeg' ? rebuildJpeg(bytes) : rebuildPng(bytes);
  return { ...info, bytes: clean };
}

// ── JPEG ────────────────────────────────────────────────────────────────────────────────────────

const SOI = 0xd8, EOI = 0xd9, SOS = 0xda, APP0 = 0xe0, APP1 = 0xe1, APP2 = 0xe2, APP14 = 0xee, COM = 0xfe;
/** Table and control segments an image needs: DHT, DQT, DRI. */
const TABLE_MARKERS = new Set([0xc4, 0xdb, 0xdd]);
/** Frame headers every target decoder supports: baseline, extended sequential, progressive. */
const FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2]);

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const startsWith = (bytes: Uint8Array, at: number, prefix: Uint8Array) =>
  prefix.every((b, i) => bytes[at + i] === b);
const EXIF_ID = ascii('Exif\0\0');
const JFIF_ID = ascii('JFIF\0');
const ICC_ID = ascii('ICC_PROFILE\0');
const ADOBE_ID = ascii('Adobe');

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  out.set([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]);
  out.set(payload, 4);
  return out;
}

/** JFIF APP0 with the source's density and no thumbnail. */
function jfifWithoutThumbnail(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(14);
  out.set(JFIF_ID);
  out.set(payload.subarray(5, 12), 5); // version, density units, x/y density
  return segment(APP0, out); // thumbnail width and height stay 0
}

/** EXIF orientation (1–8) of an APP1 payload, or 1 when absent or unreadable. */
export function exifOrientation(payload: Uint8Array): number {
  if (!startsWith(payload, 0, EXIF_ID) || payload.length < 14 + 8) return 1;
  const tiff = new DataView(payload.buffer, payload.byteOffset + 6, payload.length - 6);
  const little = tiff.getUint16(0) === 0x4949;
  if (!little && tiff.getUint16(0) !== 0x4d4d) return 1;
  const ifd = tiff.getUint32(4, little);
  if (ifd + 2 > tiff.byteLength) return 1;
  const count = tiff.getUint16(ifd, little);
  for (let n = 0; n < count; n += 1) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > tiff.byteLength) return 1;
    if (tiff.getUint16(entry, little) !== 0x0112) continue;
    const value = tiff.getUint16(entry + 8, little);
    return tiff.getUint16(entry + 2, little) === 3 && value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

/** An APP1 holding only the orientation tag (big-endian TIFF, one IFD entry). */
function orientationOnlyExif(orientation: number): Uint8Array {
  const payload = new Uint8Array(6 + 8 + 2 + 12 + 4);
  payload.set(EXIF_ID);
  payload.set([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8], 6); // "MM", 42, IFD0 at offset 8
  payload.set([0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0], 14); // 1 entry: 0x0112 SHORT ×1
  return segment(APP1, payload); // next-IFD offset stays 0
}

/** End of the entropy-coded data that starts at `from`: the next marker other than a stuffed 0 or RSTn. */
function scanEnd(bytes: Uint8Array, from: number): number {
  let i = from;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const next = bytes[i + 1];
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { i += 2; continue; }
    return i;
  }
  throw new ImageRejected('not_an_image'); // data runs to the end: no EOI
}

/** Rebuilds a JPEG from the segments an image needs; throws ImageRejected on any irregularity. */
export function rebuildJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== SOI) throw new ImageRejected('not_an_image');
  const parts: Uint8Array[] = [Uint8Array.of(0xff, SOI)];
  let jfif: Uint8Array | null = null;
  let orientation = 1;
  let frames = 0;
  let scans = 0;
  let i = 2;
  while (true) {
    if (i + 1 >= bytes.length || bytes[i] !== 0xff) throw new ImageRejected('not_an_image');
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte before a marker
    if (marker === EOI) {
      if (scans === 0 || i + 2 !== bytes.length) throw new ImageRejected('not_an_image'); // no image, or trailing bytes
      break;
    }
    if (i + 4 > bytes.length) throw new ImageRejected('not_an_image');
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    const end = i + 2 + length;
    if (length < 2 || end > bytes.length) throw new ImageRejected('not_an_image');
    const whole = bytes.subarray(i, end);
    const payload = bytes.subarray(i + 4, end);
    if (marker === SOS) {
      if (frames !== 1) throw new ImageRejected('not_an_image');
      const dataEnd = scanEnd(bytes, end);
      parts.push(bytes.subarray(i, dataEnd));
      scans += 1;
      i = dataEnd;
      continue;
    }
    if (FRAME_MARKERS.has(marker)) {
      if (frames > 0 || payload[0] !== 8) throw new ImageRejected('unsupported_format'); // one 8-bit frame
      frames += 1;
      parts.push(whole);
    } else if (TABLE_MARKERS.has(marker)) {
      parts.push(whole);
    } else if (marker === APP0) {
      if (frames === 0 && scans === 0 && startsWith(payload, 0, JFIF_ID) && payload.length >= 12) jfif = payload;
    } else if (marker === APP1) {
      orientation = frames === 0 ? Math.max(orientation, exifOrientation(payload)) : orientation;
    } else if ((marker === APP2 && startsWith(payload, 0, ICC_ID)) || (marker === APP14 && startsWith(payload, 0, ADOBE_ID))) {
      parts.push(whole);
    } else if (!((marker > APP0 && marker <= 0xef) || marker === COM)) {
      throw new ImageRejected('unsupported_format'); // SOF3/5–15, DAC, DNL, JPGn, TEM, a stray RSTn…
    }
    i = end;
  }
  parts.push(Uint8Array.of(0xff, EOI));
  const header = [jfif ? jfifWithoutThumbnail(jfif) : null, orientation > 1 ? orientationOnlyExif(orientation) : null]
    .filter((p): p is Uint8Array => p !== null);
  return concat([parts[0], ...header, ...parts.slice(1)]);
}

// ── PNG ─────────────────────────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const PNG_IMAGE_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);
const PNG_RENDERING_CHUNKS = new Set(['tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs']);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of a PNG chunk's type and data. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Rebuilds a PNG from its image and rendering chunks; throws ImageRejected on any irregularity. */
export function rebuildPng(bytes: Uint8Array): Uint8Array {
  if (!startsWith(bytes, 0, PNG_SIGNATURE)) throw new ImageRejected('not_an_image');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [PNG_SIGNATURE];
  let i = PNG_SIGNATURE.length;
  let first = true;
  let images = 0;
  while (true) {
    if (i + 12 > bytes.length) throw new ImageRejected('not_an_image');
    const length = view.getUint32(i);
    const end = i + 12 + length;
    if (end > bytes.length) throw new ImageRejected('not_an_image');
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
    if (crc32(bytes.subarray(i + 4, i + 8 + length)) !== view.getUint32(i + 8 + length)) throw new ImageRejected('not_an_image');
    if (first !== (type === 'IHDR')) throw new ImageRejected('not_an_image'); // IHDR first, and only once
    first = false;
    if (type === 'IDAT') images += 1;
    if (PNG_IMAGE_CHUNKS.has(type) || PNG_RENDERING_CHUNKS.has(type)) parts.push(bytes.subarray(i, end));
    else if (!/^[a-z]/.test(type)) throw new ImageRejected('unsupported_format'); // an unknown critical chunk
    i = end;
    if (type === 'IEND') {
      if (images === 0 || i !== bytes.length) throw new ImageRejected('not_an_image'); // no image, or trailing bytes
      return concat(parts);
    }
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
