// run: deno test --allow-read (from supabase/functions)
import { assert, assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { Jimp } from 'https://esm.sh/jimp@1.6.0';
import { ImageRejected, inspectImage, jpegFrameSize, jpegHeaderIsClean, MAX_SOURCE_BYTES } from './imageCheck.ts';
import { sanitizeImage, type Decoder } from './sanitize.ts';

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);
const segment = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];

/** A real JPEG (Jimp-encoded gradient), `width` × `height`. */
async function realJpeg(width: number, height: number): Promise<Uint8Array> {
  const image = new Jimp({ width, height, color: 0x336699ff });
  for (let x = 0; x < width; x++) image.setPixelColor(((x * 255 / width) << 24 | 0x0000ffff) >>> 0, x, 0);
  return new Uint8Array(await image.getBuffer('image/jpeg', { quality: 90 }));
}

/**
 * EXIF APP1 with a TIFF IFD0 holding Orientation = 6 and a GPS IFD pointer, followed by a
 * recognizable GPS payload, so the test can assert that none of it survives.
 */
function exifWithGps(): number[] {
  const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0, 0x02, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0, 0, 0, 0x06, 0x00, 0, 0,
    0x25, 0x88, 0x04, 0x00, 0x01, 0, 0, 0, 0x26, 0, 0, 0, 0, 0, 0, 0,
    0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x02, 0, 0, 0, 0x4e, 0x00, 0, 0, 0, 0, 0, 0];
  return segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, ...new TextEncoder().encode('GPS-32.0853N-34.7818E')]);
}

const withSegment = (jpeg: Uint8Array, seg: number[]) => new Uint8Array([...jpeg.slice(0, 2), ...seg, ...jpeg.slice(2)]);

Deno.test('a real photo with an EXIF/GPS block comes out with no metadata, re-encoded and oriented', async () => {
  const input = withSegment(await realJpeg(300, 200), exifWithGps());
  assert(latin1(input).includes('Exif') && latin1(input).includes('GPS-32.0853N'), 'fixture carries EXIF + GPS');
  const out = await sanitizeImage(input);
  for (const copy of [out.derivative, out.thumb]) {
    assert(jpegHeaderIsClean(copy.bytes), 'output header is clean');
    assert(!latin1(copy.bytes).includes('Exif'), 'no Exif marker in output');
    assert(!latin1(copy.bytes).includes('GPS-32.0853N'), 'no GPS payload in output');
  }
  // Orientation 6 is applied to the pixels (300×200 stored → shown 200×300), then dropped.
  assertEquals([out.derivative.width, out.derivative.height], [200, 300]);
  assertEquals(jpegFrameSize(out.derivative.bytes), { width: 200, height: 300 });
});

Deno.test('copies are bounded at 2048 px and 400 px and never upscaled', async () => {
  const out = await sanitizeImage(await realJpeg(2400, 1200));
  assertEquals([out.derivative.width, out.derivative.height], [2048, 1024]);
  assertEquals([out.thumb.width, out.thumb.height], [400, 200]);
  const small = await sanitizeImage(await realJpeg(120, 80));
  assertEquals([small.derivative.width, small.thumb.width], [120, 120]);
});

Deno.test('a PNG becomes JPEG copies', async () => {
  const png = new Uint8Array(await new Jimp({ width: 50, height: 40, color: 0xff0000ff }).getBuffer('image/png'));
  const out = await sanitizeImage(png);
  assertEquals(out.source.type, 'image/png');
  assert(jpegHeaderIsClean(out.derivative.bytes));
});

Deno.test('wrong magic bytes are refused before decoding: HTML and SVG labelled as images', async () => {
  let decoded = false;
  const spy: Decoder = () => { decoded = true; throw new Error('must not decode'); };
  for (const text of ['<!doctype html><script>alert(1)</script>', '<svg xmlns="http://www.w3.org/2000/svg"/>']) {
    const err = await assertRejects(() => sanitizeImage(new TextEncoder().encode(text), spy), ImageRejected);
    assertEquals((err as ImageRejected).code, 'not_an_image');
  }
  assertEquals(decoded, false);
});

Deno.test('a decompression bomb (huge declared dimensions, tiny file) is refused from its header', async () => {
  let decoded = false;
  const spy: Decoder = () => { decoded = true; throw new Error('must not decode'); };
  const bomb = new Uint8Array([0xff, 0xd8, ...segment(0xc0, [8, 0x75, 0x30, 0x75, 0x30, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]), 0xff, 0xda]);
  const err = await assertRejects(() => sanitizeImage(bomb, spy), ImageRejected);
  assertEquals((err as ImageRejected).code, 'too_many_pixels');
  const tall = new Uint8Array([0xff, 0xd8, ...segment(0xc0, [8, 0x13, 0x88, 0x00, 0x10, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1])]);
  assertThrows(() => inspectImage(tall), ImageRejected, 'too_many_pixels'); // 5000 px edge
  assertEquals(decoded, false);
});

Deno.test('oversize bytes, missing dimensions and undecodable data are refused', async () => {
  assertThrows(() => inspectImage(new Uint8Array(MAX_SOURCE_BYTES + 1).fill(0xff)), ImageRejected, 'too_large');
  assertThrows(() => inspectImage(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), ImageRejected, 'no_dimensions');
  const header = (await realJpeg(64, 64)).slice(0, 300); // valid header, truncated image data
  const err = await assertRejects(() => sanitizeImage(header, () => Promise.reject(new Error('corrupt'))), ImageRejected);
  assertEquals((err as ImageRejected).code, 'not_an_image');
});

Deno.test('jpegHeaderIsClean fails closed', () => {
  assertEquals(jpegHeaderIsClean(new Uint8Array([0xff, 0xd8, ...segment(0xe1, [1]), 0xff, 0xda])), false);
  assertEquals(jpegHeaderIsClean(new Uint8Array([0xff, 0xd8, ...segment(0xfe, [1]), 0xff, 0xda])), false);
  assertEquals(jpegHeaderIsClean(new Uint8Array([0xff, 0xd8, 0x00, 0x00])), false); // broken walk
  assertEquals(jpegHeaderIsClean(new Uint8Array([0xff, 0xd8, ...segment(0xe0, [1]), 0xff, 0xda, 0, 2])), true);
});
