import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/** A colour as red, green, blue; every pixel is opaque. */
export type Rgb = readonly [number, number, number];

const DEFAULT_COLOUR: Rgb = [0x33, 0x66, 0x99];

/**
 * RGBA pixels of a `width` × `height` image: a red gradient along the first
 * row, so the image is not one flat colour, and `colour` everywhere else.
 */
function pixels(width: number, height: number, colour: Rgb): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const [red, green, blue] = index < width ? [Math.floor((index * 255) / width), 0, 0] : colour;
    data.set([red, green, blue, 0xff], index * 4);
  }
  return data;
}

/** A real baseline JPEG, encoded here: a file a decoder accepts, not a stand-in. */
export function realJpeg(width: number, height: number, colour: Rgb = DEFAULT_COLOUR): Uint8Array {
  return new Uint8Array(jpeg.encode({ data: pixels(width, height, colour), width, height }, 90).data);
}

/** A real PNG, encoded here. */
export function realPng(width: number, height: number, colour: Rgb = DEFAULT_COLOUR): Uint8Array {
  const png = new PNG({ width, height });
  pixels(width, height, colour).copy(png.data);
  return new Uint8Array(PNG.sync.write(png));
}

/** The decoded RGBA pixels of a JPEG. @throws When the bytes are not a JPEG a decoder accepts. */
export function jpegPixels(bytes: Uint8Array): Uint8Array {
  return jpeg.decode(bytes, { useTArray: true }).data;
}

/** The decoded RGBA pixels of a PNG. @throws When the bytes are not a PNG a decoder accepts. */
export function pngPixels(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(PNG.sync.read(Buffer.from(bytes)).data);
}
