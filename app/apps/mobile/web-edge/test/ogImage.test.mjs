import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  coverCandidates, OG_IMAGE_MAX_BYTES, probeImage, selectOgImage, thumbKey, verifyImage, verifyJpeg, verifyPng,
} from '../src/ogImage.mjs';

const config = { supabaseUrl: 'https://proj.supabase.co', appBaseUrl: 'https://karma-community-kc.com' };
const LOGO = { url: 'https://karma-community-kc.com/pwa-icon-512.png', type: 'image/png', width: 512, height: 512 };

/** A complete minimal JPEG: SOI, a table, SOF0 with the size, a scan, EOI; `padTo` grows the scan. */
function jpeg(width, height, { padTo = 0 } = {}) {
  const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0];
  const head = [0xff, 0xd8, ...dqt, ...sof, ...sos];
  const data = new Array(Math.max(4, padTo - head.length - 2)).fill(0x2a);
  return new Uint8Array([...head, ...data, 0xff, 0xd9]);
}
function png(width, height) {
  const b = new Uint8Array(8 + 25 + 12);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44], 33); // IEND (length 0); CRC bytes left zero
  return b;
}
/** A complete storage answer: 200 with the declared length. */
const complete = (bytes, type = 'image/jpeg') => new Response(bytes, {
  status: 200, headers: { 'content-type': type, 'content-length': String(bytes.length) },
});

describe('verifyImage', () => {
  it('reads the size of a complete JPEG and PNG', () => {
    assert.deepEqual(verifyJpeg(jpeg(2048, 1536)), { width: 2048, height: 1536 });
    assert.deepEqual(verifyPng(png(512, 256)), { width: 512, height: 256 });
    assert.deepEqual(verifyImage(png(512, 256)), { type: 'image/png', width: 512, height: 256 });
  });
  it('recognizes the bytes, not the declared type: HTML is not an image', () => {
    assert.equal(verifyImage(new TextEncoder().encode('<html><script>x</script></html>')), null);
    assert.equal(verifyImage(new Uint8Array(0)), null);
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
  it('asks for the whole file (no range) and describes a qualifying image', async () => {
    let init = null;
    const image = await probeImage('https://x/0-thumb.jpg', async (_url, i) => { init = i; return complete(jpeg(400, 300)); });
    assert.equal(init.headers, undefined);
    assert.deepEqual(image, { url: 'https://x/0-thumb.jpg', type: 'image/jpeg', width: 400, height: 300 });
    assert.deepEqual(await probeImage('https://x/p.png', async () => complete(png(600, 315), 'image/png')),
      { url: 'https://x/p.png', type: 'image/png', width: 600, height: 315 });
  });
  it('rejects heavy, missing, narrow or failing answers', async () => {
    const heavy = new Response(new Uint8Array(4), { status: 200, headers: { 'content-length': String(OG_IMAGE_MAX_BYTES + 1) } });
    for (const res of [heavy, new Response('not found', { status: 404 }), complete(jpeg(120, 90))]) {
      assert.equal(await probeImage('https://x/y.jpg', async () => res), null);
    }
    assert.equal(await probeImage('https://x/y.jpg', async () => { throw new Error('reset'); }), null);
  });
  it('stops reading a body that grows past its declared length', async () => {
    const lying = new Response(jpeg(400, 300, { padTo: 5000 }), { status: 200, headers: { 'content-length': '100' } });
    assert.equal(await probeImage('https://x/y.jpg', async () => lying), null);
  });
});

describe('selectOgImage', () => {
  const row = { cover_bucket: 'post-images', cover_key: 'u/b/0.jpg' };
  const store = (answers) => async (url) => answers[url.endsWith('-thumb.jpg') ? 'thumb' : 'full']();

  it('prefers the photo when it qualifies', async () => {
    const image = await selectOgImage(row, config, store({ full: () => complete(jpeg(1200, 900)), thumb: () => complete(jpeg(400, 300)) }));
    assert.equal(image.width, 1200);
    assert.ok(image.url.endsWith('/u/b/0.jpg'));
  });
  it('uses the thumb when the photo is over the size cap', async () => {
    const heavy = () => new Response(new Uint8Array(4), { status: 200, headers: { 'content-length': '520000' } });
    const image = await selectOgImage(row, config, store({ full: heavy, thumb: () => complete(jpeg(400, 300)) }));
    assert.ok(image.url.endsWith('/u/b/0-thumb.jpg'));
    assert.equal(image.type, 'image/jpeg');
  });
  it('falls back to the logo when neither qualifies, or there is no cover at all', async () => {
    const none = store({ full: () => new Response('', { status: 404 }), thumb: () => new Response('', { status: 404 }) });
    assert.deepEqual(await selectOgImage(row, config, none), LOGO);
    let fetched = false;
    assert.deepEqual(await selectOgImage({ cover_bucket: null, cover_key: null }, config, async () => { fetched = true; }), LOGO);
    assert.equal(fetched, false);
  });
});
