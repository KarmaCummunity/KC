/** Pixel-level contract for Android notification branding (#1757), using only Node built-ins. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const assets = new URL('../app/apps/mobile/assets/', import.meta.url);

// Decode non-interlaced 8-bit RGBA PNGs, including every PNG scanline filter. This deliberately
// rejects palette/RGB formats: notification masks must keep explicit alpha without a backdrop.
function rgbaPng(name) {
  const bytes = readFileSync(new URL(name, assets));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8, '8-bit channels');
  assert.equal(bytes[25], 6, 'RGBA with explicit alpha');
  assert.equal(bytes[28], 0, 'non-interlaced');
  const chunks = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') chunks.push(bytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * 4;
  assert.equal(raw.length, height * (stride + 1));
  const pixels = Buffer.alloc(width * height * 4);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4, 'known PNG filter');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? pixels[i - 4] : 0;
      const b = y ? pixels[i - stride] : 0, c = y && x >= 4 ? pixels[i - stride - 4] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      pixels[i] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return { width, height, pixels, alpha: (x, y) => pixels[(y * width + x) * 4 + 3] };
}

function alphaBounds(image) {
  let left = image.width, top = image.height, right = 0, bottom = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (image.alpha(x, y)) {
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
  }
  return { left, top, width: right - left, height: bottom - top };
}

test('notification icon is a white alpha-only 96px PNG with transparent margins', () => {
  const icon = rgbaPng('notification-icon.png');
  assert.equal(icon.width, 96); assert.equal(icon.height, 96);
  let visible = 0;
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
    const i = (y * 96 + x) * 4;
    if (icon.alpha(x, y)) {
      visible++;
      assert.deepEqual([...icon.pixels.subarray(i, i + 3)], [255, 255, 255]);
    }
    if (x < 8 || x >= 88 || y < 13 || y >= 83) assert.equal(icon.alpha(x, y), 0);
  }
  assert.ok(visible > 1500 && visible < 5000, 'nonempty mask, no opaque backdrop');
});

test('notification mask derives from the existing KC monochrome mark, not the generic heart', () => {
  const source = rgbaPng('adaptive-icon-monochrome.png'), icon = rgbaPng('notification-icon.png');
  const bounds = alphaBounds(source);
  // Reproduction: crop the source to nonzero alpha; nearest-neighbor resize to 80x70;
  // center on a transparent 96x96 canvas at (8,13), setting visible RGB to white.
  // The original mark is 540x474: this rounded size preserves its aspect to <0.4%.
  assert.ok(Math.abs(80 / 70 - bounds.width / bounds.height) < 0.005);
  for (let y = 0; y < 70; y++) for (let x = 0; x < 80; x++) {
    const sx = bounds.left + Math.floor((x + 0.5) * bounds.width / 80);
    const sy = bounds.top + Math.floor((y + 0.5) * bounds.height / 70);
    assert.equal(icon.alpha(x + 8, y + 13), source.alpha(sx, sy), `brand alpha at ${x},${y}`);
  }
});

test('expo-notifications uses the checked asset and existing brand tint', () => {
  const config = JSON.parse(readFileSync(new URL('../app/apps/mobile/app.json', import.meta.url), 'utf8'));
  const plugin = config.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications');
  assert.equal(plugin[1].icon, './assets/notification-icon.png');
  assert.equal(plugin[1].color, '#F97316');
});
