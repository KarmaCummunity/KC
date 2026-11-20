import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  coverCandidates, jpegHasExif, jpegSize, OG_IMAGE_MAX_BYTES, probeImage, selectOgImage, sniffImage, thumbKey,
} from '../src/ogImage.mjs';

const config = { supabaseUrl: 'https://proj.supabase.co', appBaseUrl: 'https://karma-community-kc.com' };
const LOGO = { url: 'https://karma-community-kc.com/pwa-icon-512.png', type: 'image/png', width: 512, height: 512 };

/** A minimal JPEG header: SOI, optional APP1 Exif, a quantization table, then SOF0 with the size. */
function jpeg(width, height, { exif = false } = {}) {
  const app1 = exif ? [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00] : [];
  const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app1, ...dqt, ...sof, 0xff, 0xda, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}
function png(width, height) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}
/** A storage answer for a ranged GET: 206 with the total size in content-range. */
const ranged = (bytes, total, type = 'image/jpeg') => new Response(bytes, {
  status: 206,
  headers: { 'content-type': type, 'content-range': `bytes 0-${bytes.length - 1}/${total}` },
});

describe('header parsing', () => {
  it('reads JPEG and PNG dimensions and spots an EXIF block', () => {
    assert.deepEqual(jpegSize(jpeg(2048, 1536)), { width: 2048, height: 1536 });
    assert.equal(jpegHasExif(jpeg(10, 10)), false);
    assert.equal(jpegHasExif(jpeg(10, 10, { exif: true })), true);
    assert.deepEqual(sniffImage(png(512, 256)), { type: 'image/png', size: { width: 512, height: 256 }, exif: false });
  });
  it('recognizes the bytes, not the declared type: HTML is not an image', () => {
    assert.equal(sniffImage(new TextEncoder().encode('<html><script>x</script></html>')), null);
    assert.equal(sniffImage(new Uint8Array(0)), null);
  });
});

describe('coverCandidates / thumbKey', () => {
  it('lists the photo then its thumb, encoding each path segment', () => {
    assert.deepEqual(coverCandidates({ cover_bucket: 'post-images', cover_key: 'u/a b/0.jpg' }, config), [
      'https://proj.supabase.co/storage/v1/object/public/post-images/u/a%20b/0.jpg',
      'https://proj.supabase.co/storage/v1/object/public/post-images/u/a%20b/0-thumb.jpg',
    ]);
    assert.equal(thumbKey('a.b/c'), 'a.b/c-thumb');
  });
  it('has no candidate for no cover, a foreign bucket or missing config', () => {
    assert.deepEqual(coverCandidates({ cover_bucket: null, cover_key: null }, config), []);
    assert.deepEqual(coverCandidates({ cover_bucket: 'chat-media', cover_key: 'x.jpg' }, config), []);
    assert.deepEqual(coverCandidates({ cover_bucket: 'post-images', cover_key: 'x.jpg' }, { ...config, supabaseUrl: '' }), []);
  });
});

describe('probeImage', () => {
  it('asks for the first 64 KB only and describes a usable image', async () => {
    let init = null;
    const image = await probeImage('https://x/0-thumb.jpg', async (_url, i) => { init = i; return ranged(jpeg(400, 300), 30_000); });
    assert.equal(init.headers.range, 'bytes=0-65535');
    assert.deepEqual(image, { url: 'https://x/0-thumb.jpg', type: 'image/jpeg', width: 400, height: 300 });
  });
  it('accepts a full 200 answer within budget, sized by content-length', async () => {
    const res = new Response(png(600, 315), { status: 200, headers: { 'content-length': '5000' } });
    assert.deepEqual(await probeImage('https://x/p.png', async () => res), { url: 'https://x/p.png', type: 'image/png', width: 600, height: 315 });
  });
  it('rejects heavy, missing, non-image, EXIF-carrying, narrow, unsized or failing answers', async () => {
    const cases = [
      ranged(jpeg(2048, 1536), OG_IMAGE_MAX_BYTES + 1),
      new Response('not found', { status: 404 }),
      ranged(new TextEncoder().encode('<html></html>'), 100, 'image/jpeg'),
      ranged(jpeg(400, 300, { exif: true }), 30_000),
      ranged(jpeg(120, 90), 3_000),
      new Response(jpeg(400, 300), { status: 200 }),
    ];
    for (const res of cases) assert.equal(await probeImage('https://x/y.jpg', async () => res), null);
    assert.equal(await probeImage('https://x/y.jpg', async () => { throw new Error('reset'); }), null);
  });
});

describe('selectOgImage', () => {
  const row = { cover_bucket: 'post-images', cover_key: 'u/b/0.jpg' };
  const store = (answers) => async (url) => answers[url.endsWith('-thumb.jpg') ? 'thumb' : 'full']();

  it('prefers the photo when it is light enough', async () => {
    const image = await selectOgImage(row, config, store({ full: () => ranged(jpeg(1200, 900), 250_000), thumb: () => ranged(jpeg(400, 300), 30_000) }));
    assert.equal(image.width, 1200);
    assert.ok(image.url.endsWith('/u/b/0.jpg'));
  });
  it('uses the thumb when the 2048 px photo is too heavy', async () => {
    const image = await selectOgImage(row, config, store({ full: () => ranged(jpeg(2048, 1536), 520_000), thumb: () => ranged(jpeg(400, 300), 30_000) }));
    assert.ok(image.url.endsWith('/u/b/0-thumb.jpg'));
    assert.equal(image.type, 'image/jpeg');
  });
  it('falls back to the logo when neither is usable, or there is no cover at all', async () => {
    const none = store({ full: () => new Response('', { status: 404 }), thumb: () => new Response('', { status: 404 }) });
    assert.deepEqual(await selectOgImage(row, config, none), LOGO);
    let fetched = false;
    assert.deepEqual(await selectOgImage({ cover_bucket: null, cover_key: null }, config, async () => { fetched = true; }), LOGO);
    assert.equal(fetched, false);
  });
});
