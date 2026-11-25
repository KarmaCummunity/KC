import { describe, expect, it } from 'vitest';
import { jpegPixels, pngPixels, realJpeg, realPng } from '../../../__tests__/support/testImages';
import { ImageRejected, inspectImage, jpegFrameSize, MAX_SOURCE_BYTES } from '../imageCheck';
import { crc32, exifOrientation, sanitizeImage } from '../sanitize';

/** Runs `run`, which must refuse the file, and returns the refusal. */
function rejection(run: () => unknown): ImageRejected {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ImageRejected);
    return error as ImageRejected;
  }
  throw new Error('expected the image to be refused');
}

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);
const segment = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
const text = (s: string) => [...new TextEncoder().encode(s)];

/**
 * EXIF APP1 with a TIFF IFD0 holding Orientation = 6 and a GPS IFD pointer, followed by a
 * recognizable GPS payload, so the test can assert that none of it survives.
 */
function exifWithGps(orientation = 6): number[] {
  const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0, 0x02, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0, 0, 0, orientation, 0x00, 0, 0,
    0x25, 0x88, 0x04, 0x00, 0x01, 0, 0, 0, 0x26, 0, 0, 0, 0, 0, 0, 0,
    0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x02, 0, 0, 0, 0x4e, 0x00, 0, 0, 0, 0, 0, 0];
  return segment(0xe1, [...text('Exif\0\0'), ...tiff, ...text('GPS-32.0853N-34.7818E')]);
}

/** Inserts segments right after SOI. */
const withSegments = (jpeg: Uint8Array, ...segs: number[][]) =>
  new Uint8Array([...jpeg.slice(0, 2), ...segs.flat(), ...jpeg.slice(2)]);

/** A PNG chunk with a correct CRC. */
function chunk(type: string, data: number[]): number[] {
  const body = new Uint8Array([...text(type), ...data]);
  const crc = crc32(body);
  return [data.length >>> 24, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255,
    ...body, crc >>> 24, (crc >> 16) & 255, (crc >> 8) & 255, crc & 255];
}

/** Inserts chunks after IHDR (signature 8 bytes + IHDR chunk 25 bytes). */
const withChunks = (png: Uint8Array, ...chunks: number[][]) =>
  new Uint8Array([...png.slice(0, 33), ...chunks.flat(), ...png.slice(33)]);

describe('image sanitizer (process-post-media)', () => {
  it('a photo with EXIF/GPS, XMP, IPTC and a comment keeps only its image data and its orientation', async () => {
    const source = realJpeg(320, 240);
    const dirty = withSegments(source, exifWithGps(), segment(0xe1, text('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>secret')),
      segment(0xed, text('Photoshop 3.0\0IPTC-city')), segment(0xfe, text('my home')));
    const clean = sanitizeImage(dirty);
    const out = latin1(clean.bytes);
    for (const leak of ['GPS-32.0853N', 'xmpmeta', 'IPTC-city', 'my home']) expect(!out.includes(leak), leak).toBeTruthy();
    expect(exifOrientation(clean.bytes.subarray(clean.bytes.indexOf(0x45) /* 'E' of Exif */))).toEqual(6);
    expect([clean.type, clean.width, clean.height]).toEqual(['image/jpeg', 320, 240]);
    // The image itself is untouched: the upload and the copy decode to the same (rotated) pixels.
    expect(jpegPixels(clean.bytes)).toEqual(jpegPixels(dirty));
  });

  it('the orientation APP1 holds exactly one tag and nothing else', async () => {
    const clean = sanitizeImage(withSegments(realJpeg(16, 8), exifWithGps(8)));
    const at = latin1(clean.bytes).indexOf('Exif\0\0');
    expect((clean.bytes[at - 2]! << 8) | clean.bytes[at - 1]!, 'APP1 length: 32 bytes of payload').toEqual(34);
    expect(exifOrientation(clean.bytes.subarray(at, at + 32))).toEqual(8);
    // Upright photos (orientation 1, or none) carry no APP1 at all.
    expect(!latin1(sanitizeImage(withSegments(realJpeg(16, 8), exifWithGps(1))).bytes).includes('Exif')).toBeTruthy();
  });

  it('JFIF is kept without its thumbnail; ICC and Adobe segments are kept', async () => {
    const source = realJpeg(16, 8);
    const jfifWithThumb = segment(0xe0, [...text('JFIF\0'), 1, 2, 1, 0, 72, 0, 72, 1, 1, 0xaa, 0xbb, 0xcc]);
    const icc = segment(0xe2, [...text('ICC_PROFILE\0'), 1, 1, 9, 9, 9]);
    const adobe = segment(0xee, [...text('Adobe'), 0, 100, 0, 0, 0, 0, 1]);
    const stripped = source.subarray(2 + 4 + ((source[4]! << 8) | source[5]!) - 2); // drop the encoder's own APP0
    const clean = sanitizeImage(withSegments(new Uint8Array([0xff, 0xd8, ...stripped]), jfifWithThumb, icc, adobe)).bytes;
    expect([...clean.subarray(2, 20)]).toEqual(segment(0xe0, [...text('JFIF\0'), 1, 2, 1, 0, 72, 0, 72, 0, 0]));
    expect(latin1(clean).includes('ICC_PROFILE') && latin1(clean).includes('Adobe')).toBeTruthy();
  });

  it('a PNG keeps its image and rendering chunks and loses text, eXIf and time', async () => {
    const source = realPng(20, 10);
    const dirty = withChunks(source, chunk('tEXt', text('GPS\0home')), chunk('iTXt', text('XML:com.adobe.xmp\0\0\0\0\0secret')),
      chunk('eXIf', [0x4d, 0x4d, 0, 0x2a]), chunk('tIME', [7, 234, 1, 1, 0, 0, 0]), chunk('gAMA', [0, 0, 0xb1, 0x8f]));
    const clean = sanitizeImage(dirty);
    for (const leak of ['tEXt', 'iTXt', 'eXIf', 'tIME', 'secret', 'home']) expect(!latin1(clean.bytes).includes(leak), leak).toBeTruthy();
    expect(latin1(clean.bytes).includes('gAMA')).toBeTruthy();
    expect([clean.type, clean.width, clean.height]).toEqual(['image/png', 20, 10]);
    expect(pngPixels(clean.bytes)).toEqual(pngPixels(source));
  });

  it('wrong magic bytes are refused: HTML and SVG labelled as images', () => {
    for (const body of ['<html><script>alert(1)</script></html>', '<svg xmlns="http://www.w3.org/2000/svg"/>']) {
      const err = rejection(() => sanitizeImage(new TextEncoder().encode(body)));
      expect(err.code).toEqual('not_an_image');
    }
  });

  it('a decompression bomb (huge declared dimensions, tiny file) is refused from its header', () => {
    const bomb = new Uint8Array([0xff, 0xd8, ...segment(0xc0, [8, 0x75, 0x30, 0x75, 0x30, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), 0xff, 0xd9]);
    expect(jpegFrameSize(bomb)).toEqual({ width: 30000, height: 30000 });
    expect(rejection(() => sanitizeImage(bomb)).code).toEqual('too_many_pixels');
  });

  it('a JPEG with trailing bytes (a polyglot), a truncated one, or no EOI is refused', async () => {
    const jpeg = realJpeg(16, 8);
    const cases = [new Uint8Array([...jpeg, ...text('PK\u0003\u0004zip')]), jpeg.subarray(0, jpeg.length - 40), jpeg.subarray(0, jpeg.length - 2)];
    for (const bytes of cases) expect(rejection(() => sanitizeImage(bytes)).code).toEqual('not_an_image');
  });

  it('unsupported JPEG coding (12-bit, lossless, arithmetic) and unknown markers are refused', async () => {
    const jpeg = realJpeg(16, 8);
    const sof = latin1(jpeg).indexOf('\xff\xc0');
    const twelveBit = jpeg.slice();
    twelveBit[sof + 4] = 12;
    const lossless = jpeg.slice();
    lossless[sof + 1] = 0xc3;
    for (const bytes of [twelveBit, lossless, withSegments(jpeg, segment(0xcc, [0, 0]))]) {
      expect(rejection(() => sanitizeImage(bytes)).code).toEqual('unsupported_format');
    }
  });

  it('a PNG with a bad CRC, an unknown critical chunk, IHDR not first or bytes after IEND is refused', async () => {
    const png = realPng(8, 8);
    const badCrc = png.slice();
    badCrc[29]! ^= 0xff; // inside IHDR's CRC
    expect(rejection(() => sanitizeImage(badCrc)).code).toEqual('not_an_image');
    expect(rejection(() => sanitizeImage(withChunks(png, chunk('ZZZZ', [1])))).code).toEqual('unsupported_format');
    expect(rejection(() => sanitizeImage(new Uint8Array([...png, 0]))).code).toEqual('not_an_image');
    const ihdrSecond = new Uint8Array([...png.slice(0, 8), ...chunk('gAMA', [0, 0, 0xb1, 0x8f]), ...png.slice(8)]);
    expect(rejection(() => sanitizeImage(ihdrSecond)).code).toEqual('no_dimensions'); // the size is read from IHDR
  });

  it('oversize bytes and missing dimensions are refused; the caps are a parameter', async () => {
    expect(rejection(() => inspectImage(new Uint8Array(MAX_SOURCE_BYTES + 1))).code).toEqual('too_large');
    expect(rejection(() => inspectImage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).code).toEqual('no_dimensions');
    const thumbCaps = { maxSourceEdge: 1024, maxSourcePixels: 1024 * 1024 };
    const wide = realJpeg(1025, 4);
    expect(rejection(() => sanitizeImage(wide, thumbCaps)).code).toEqual('too_many_pixels');
    expect(sanitizeImage(realJpeg(1024, 4), thumbCaps).width).toEqual(1024);
  });

  it('a JPEG with several scans (as progressive files have) is walked scan by scan to its EOI', async () => {
    const baseline = realJpeg(64, 32);
    // The encoder writes one scan only; repeating the scan gives the walk a second SOS after entropy data.
    const sos = latin1(baseline).indexOf('\xff\xda');
    const eoi = baseline.length - 2;
    const progressive = new Uint8Array([...baseline.subarray(0, eoi), ...baseline.subarray(sos, eoi), 0xff, 0xd9]);
    const clean = sanitizeImage(progressive);
    expect(clean.bytes.length).toEqual(progressive.length);
  });
});
