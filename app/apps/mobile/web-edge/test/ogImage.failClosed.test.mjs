// Regression: a preview image must FAIL CLOSED. Nothing may be certified free of metadata from
// a partial read. Includes the independent reviewer's reproducer (EXIF hidden behind a large APP2
// segment so it sits past the first 64 KiB), unknown and mismatched sizes, a ranged (partial)
// answer, and PNG metadata chunks.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { probeImage, selectOgImage } from '../src/ogImage.mjs';

const segment = (marker, body) => Uint8Array.from([255, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]);
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const SOI = Uint8Array.from([0xff, 0xd8]);
const EOI = Uint8Array.from([0xff, 0xd9]);
/** SOF0 of a 400×400, 3-component baseline frame. */
const sof = segment(0xc0, Uint8Array.from([8, 1, 144, 1, 144, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0]));
/** A scan header plus a few entropy-coded bytes, including a stuffed 0xFF00 and a restart marker. */
const scan = concat(segment(0xda, Uint8Array.from([3, 1, 0, 2, 17, 3, 17, 0, 63, 0])), Uint8Array.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]));
const exif = segment(0xe1, Uint8Array.from([69, 120, 105, 102, 0, 0, 71, 80, 83]));
const cleanJpeg = concat(SOI, segment(0xe0, Uint8Array.from([74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])), sof, scan, EOI);

/** A complete 200 answer that declares its true length. */
const full = (bytes, type = 'image/jpeg') => async () =>
  new Response(bytes, { status: 200, headers: { 'content-type': type, 'content-length': String(bytes.length) } });

describe('reviewer reproducer: EXIF after a large APP2 segment', () => {
  const padding = segment(0xe2, new Uint8Array(65533));
  const bytes = concat(SOI, padding, exif, sof, EOI);

  it('is rejected when the crawler-side probe only gets the first 64 KiB (206 range answer)', async () => {
    const partial = async () => new Response(bytes.slice(0, 65536), {
      status: 206,
      headers: { 'content-range': `bytes 0-65535/${bytes.length}` },
    });
    assert.equal(await probeImage('https://example.test/object.jpg', partial), null);
  });

  it('is rejected when the whole file is read: the APP1 Exif block is found past 64 KiB', async () => {
    assert.equal(await probeImage('https://example.test/object.jpg', full(bytes)), null);
  });
});

describe('indeterminate answers are rejected, never assumed clean', () => {
  it('unknown size (no content-length)', async () => {
    const res = async () => new Response(cleanJpeg, { status: 200 });
    assert.equal(await probeImage('https://x/a.jpg', res), null);
  });
  it('truncated body (fewer bytes than declared)', async () => {
    const res = async () => new Response(cleanJpeg.slice(0, 40), { status: 200, headers: { 'content-length': String(cleanJpeg.length) } });
    assert.equal(await probeImage('https://x/a.jpg', res), null);
  });
  it('a JPEG cut before its end marker', async () => {
    const cut = cleanJpeg.slice(0, cleanJpeg.length - 2);
    assert.equal(await probeImage('https://x/a.jpg', full(cut)), null);
  });
  it('XMP, IPTC and comment segments, which can carry location text too', async () => {
    for (const marker of [0xe1, 0xed, 0xfe]) {
      const bytes = concat(SOI, segment(marker, Uint8Array.from([1, 2, 3])), sof, scan, EOI);
      assert.equal(await probeImage('https://x/a.jpg', full(bytes)), null, `marker ${marker.toString(16)}`);
    }
  });
  it('HTML served as image/jpeg', async () => {
    assert.equal(await probeImage('https://x/a.jpg', full(new TextEncoder().encode('<html><svg/></html>'))), null);
  });
});

describe('a complete, clean file is accepted', () => {
  it('JPEG with only JFIF + frame + scan', async () => {
    assert.deepEqual(await probeImage('https://x/a.jpg', full(cleanJpeg)), { url: 'https://x/a.jpg', type: 'image/jpeg', width: 400, height: 400 });
  });
});

describe('PNG: every chunk is inspected', () => {
  const crcless = (type, data = new Uint8Array(0)) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    return out; // the CRC (last 4 bytes) is not checked by the probe
  };
  const ihdr = () => {
    const d = new Uint8Array(13);
    new DataView(d.buffer).setUint32(0, 640);
    new DataView(d.buffer).setUint32(4, 320);
    d.set([8, 6, 0, 0, 0], 8);
    return crcless('IHDR', d);
  };
  const SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = (...chunks) => concat(SIG, ihdr(), ...chunks, crcless('IDAT', Uint8Array.from([1, 2])), crcless('IEND'));

  it('accepts a PNG made only of image chunks', async () => {
    assert.deepEqual(await probeImage('https://x/a.png', full(png(), 'image/png')), { url: 'https://x/a.png', type: 'image/png', width: 640, height: 320 });
  });
  it('rejects eXIf and text chunks, and a PNG without IEND', async () => {
    for (const type of ['eXIf', 'tEXt', 'zTXt', 'iTXt']) {
      assert.equal(await probeImage('https://x/a.png', full(png(crcless(type, Uint8Array.from([1]))), 'image/png')), null, type);
    }
    const noEnd = concat(SIG, ihdr(), crcless('IDAT', Uint8Array.from([1])));
    assert.equal(await probeImage('https://x/a.png', full(noEnd, 'image/png')), null);
  });
});

describe('selectOgImage stays fail-closed end to end', () => {
  it('falls back to the logo when both the photo and its thumb carry EXIF', async () => {
    const tainted = concat(SOI, exif, sof, scan, EOI);
    const image = await selectOgImage(
      { cover_bucket: 'post-images', cover_key: 'u/b/0.jpg' },
      { supabaseUrl: 'https://p.supabase.co', appBaseUrl: 'https://kc.example' },
      full(tainted),
    );
    assert.equal(image.url, 'https://kc.example/pwa-icon-512.png');
  });
});
