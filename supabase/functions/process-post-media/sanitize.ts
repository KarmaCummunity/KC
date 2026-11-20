// process-post-media · turns an uploaded photo into the sanitized copies others may see.
//
// Order matters: the bytes are inspected (signature, dimensions, caps) BEFORE the decoder runs,
// then the pixels are re-encoded into brand-new JPEGs. A re-encode carries no metadata over from
// the source (measured with Jimp 1.6.0: an injected APP1 Exif/GPS block is absent from the
// output, and EXIF orientation is applied to the pixels before it is dropped). Each output is
// checked again, fail-closed, before it is returned.

import { Jimp } from 'https://esm.sh/jimp@1.6.0';
import { ImageRejected, inspectImage, jpegHeaderIsClean, type ImageInfo } from './imageCheck.ts';

/** Longest edge of the copy a post page shows (FR-POST-005 AC3: client side resize to 2048). */
export const DERIVATIVE_MAX_EDGE = 2048;
/** Longest edge of the feed-card copy (the app's `-thumb` convention). */
export const THUMB_MAX_EDGE = 400;
const DERIVATIVE_QUALITY = 85;
const THUMB_QUALITY = 75;

export interface EncodedImage {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface SanitizedImage {
  readonly source: ImageInfo;
  readonly derivative: EncodedImage;
  readonly thumb: EncodedImage;
}

/** Decoded pixels the encoder can resize and write; the Jimp surface this module uses. */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  clone(): DecodedImage;
  resize(size: { w: number; h: number }): unknown;
  getBuffer(mime: 'image/jpeg', options: { quality: number }): Promise<ArrayBuffer | Uint8Array>;
}

/** Decodes bytes into pixels; injectable so tests can prove the decoder is never reached. */
export type Decoder = (bytes: Uint8Array) => Promise<DecodedImage>;

export const jimpDecoder: Decoder = async (bytes) =>
  (await Jimp.read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)) as unknown as DecodedImage;

/** Scales into a maxEdge square (never up) and encodes a JPEG. */
async function encodeWithin(image: DecodedImage, maxEdge: number, quality: number): Promise<EncodedImage> {
  const ratio = Math.min(maxEdge / image.width, maxEdge / image.height, 1);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const copy = image.clone();
  if (ratio < 1) copy.resize({ w: width, h: height });
  const bytes = new Uint8Array(await copy.getBuffer('image/jpeg', { quality }));
  if (!jpegHeaderIsClean(bytes)) throw new Error('sanitize: encoder output is not a clean JPEG');
  return { bytes, width, height };
}

/**
 * Inspects, decodes and re-encodes one upload. Throws ImageRejected for a file that is not an
 * acceptable image (final), or any other error for a decode or encode failure.
 */
export async function sanitizeImage(bytes: Uint8Array, decode: Decoder = jimpDecoder): Promise<SanitizedImage> {
  const source = inspectImage(bytes);
  let image: DecodedImage;
  try {
    image = await decode(bytes);
  } catch {
    throw new ImageRejected('not_an_image'); // a valid header over undecodable data
  }
  // The decoder applies EXIF orientation, so a rotated photo may swap its edges; the area is the same.
  if (image.width * image.height > source.width * source.height) throw new ImageRejected('too_many_pixels');
  return {
    source,
    derivative: await encodeWithin(image, DERIVATIVE_MAX_EDGE, DERIVATIVE_QUALITY),
    thumb: await encodeWithin(image, THUMB_MAX_EDGE, THUMB_QUALITY),
  };
}
