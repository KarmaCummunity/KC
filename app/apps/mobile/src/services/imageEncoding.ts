// Resize + JPEG re-encode of a picked image, returning the encoded bytes ready for upload.
//
// The re-encode is what strips EXIF on the device (FR-POST-005 AC4 is completed server-side).
// Bytes are read natively from the encoded file (`expo-file-system` File.bytes()), so the JPEG
// never travels through the bridge as a base64 string and is never decoded in a JS loop.
// `fetch(file://).blob()` is NOT used: on iOS (RN 0.81 / SDK 54) it intermittently yields an
// empty Blob, so Storage stores a 0-byte object (see `mediaEncoding.ts`). If the native read
// fails or returns something that is not a JPEG, we fall back to the proven path: encode with
// `base64: true` and decode with `base64ToUint8Array`.

import { Platform } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { base64ToUint8Array } from './mediaEncoding';

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export interface EncodedJpeg extends ImageSize {
  /** Local file of the encoded JPEG; a cheap source for a smaller derivative (the thumb). */
  readonly uri: string;
  readonly bytes: Uint8Array;
}

/**
 * Manipulator actions that fit the image inside a `maxEdge` square, keeping its aspect ratio.
 * Constrains the longer edge (a portrait photo is bounded by its height, not its width) and
 * never upscales: an image already within bounds is only re-encoded. Unknown dimensions fall
 * back to bounding the width, the pre-existing behavior.
 */
export function planMaxEdgeResize(size: ImageSize, maxEdge: number): ImageManipulator.Action[] {
  const { width, height } = size;
  if (!(width > 0) || !(height > 0)) return [{ resize: { width: maxEdge } }];
  if (Math.max(width, height) <= maxEdge) return [];
  return width >= height ? [{ resize: { width: maxEdge } }] : [{ resize: { height: maxEdge } }];
}

/** JPEG files start with the SOI marker FF D8 followed by another marker byte FF. */
export function looksLikeJpeg(bytes: Uint8Array | null | undefined): bytes is Uint8Array {
  return bytes != null && bytes.byteLength > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Reads a local (native) or blob/data (web) URI into memory without a base64 round trip. */
async function readEncodedFile(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    return new Uint8Array(await response.arrayBuffer());
  }
  return new File(uri).bytes();
}

/** The proven fallback: inline base64 from the manipulator, decoded in JS. */
async function encodeViaBase64(
  sourceUri: string,
  actions: ImageManipulator.Action[],
  compress: number,
): Promise<EncodedJpeg> {
  const result = await ImageManipulator.manipulateAsync(sourceUri, actions, {
    compress,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  if (!result.base64) throw new Error('image_encode: manipulator returned no base64 payload');
  return { uri: result.uri, width: result.width, height: result.height, bytes: base64ToUint8Array(result.base64) };
}

/** Applies `actions`, encodes as JPEG at `compress` quality and returns the bytes. */
export async function encodeJpeg(
  sourceUri: string,
  actions: ImageManipulator.Action[],
  compress: number,
): Promise<EncodedJpeg> {
  const result = await ImageManipulator.manipulateAsync(sourceUri, actions, {
    compress,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  let bytes: Uint8Array | null = null;
  try {
    bytes = await readEncodedFile(result.uri);
  } catch (err) {
    console.warn('image_encode: native read failed, using base64 fallback', err);
  }
  if (!looksLikeJpeg(bytes)) return encodeViaBase64(sourceUri, actions, compress);
  return { uri: result.uri, width: result.width, height: result.height, bytes };
}
