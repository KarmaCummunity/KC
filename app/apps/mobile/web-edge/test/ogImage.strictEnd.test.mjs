// Regression (independent review of 5827d638): bytes after the JPEG EOI or the PNG IEND chunk were
// accepted, so "every byte was checked" did not hold. The file must END at its end marker.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyImage, verifyJpeg, verifyPng } from '../src/ogImage.mjs';

describe('strict end of file', () => {
  it('reviewer reproducer: a JPEG followed by an APP1 Exif block after EOI is rejected', () => {
    const body = Uint8Array.from([255, 216, 255, 192, 0, 11, 8, 1, 144, 1, 144, 1, 1, 17, 0, 255, 217, 255, 225, 0, 8, 69, 120, 105, 102, 0, 0]);
    assert.equal(verifyImage(body), null);
  });
  it('the same JPEG ending exactly at EOI is accepted', () => {
    const body = Uint8Array.from([255, 216, 255, 192, 0, 11, 8, 1, 144, 1, 144, 1, 1, 17, 0, 255, 217]);
    assert.deepEqual(verifyJpeg(body), { width: 400, height: 400 });
  });
  it('any byte after EOI is rejected, even a lone zero', () => {
    const body = Uint8Array.from([255, 216, 255, 192, 0, 11, 8, 1, 144, 1, 144, 1, 1, 17, 0, 255, 217, 0]);
    assert.equal(verifyJpeg(body), null);
  });
  it('JPEG markers outside the known image set are rejected (JPGn, DHP/EXP)', () => {
    for (const marker of [0xc8, 0xf0, 0xfd, 0xde, 0xdf]) {
      const body = Uint8Array.from([255, 216, 255, marker, 0, 4, 1, 2, 255, 192, 0, 11, 8, 1, 144, 1, 144, 1, 1, 17, 0, 255, 217]);
      assert.equal(verifyJpeg(body), null, marker.toString(16));
    }
  });

  const chunk = (type, data = []) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    return [...out];
  };
  const ihdr = () => {
    const d = new Uint8Array(13);
    new DataView(d.buffer).setUint32(0, 300);
    new DataView(d.buffer).setUint32(4, 200);
    d.set([8, 6, 0, 0, 0], 8);
    return chunk('IHDR', [...d]);
  };
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  it('PNG: bytes after IEND are rejected; IEND must be empty', () => {
    const ok = Uint8Array.from([...SIG, ...ihdr(), ...chunk('IDAT', [1]), ...chunk('IEND')]);
    assert.deepEqual(verifyPng(ok), { width: 300, height: 200 });
    const tail = Uint8Array.from([...ok, ...chunk('eXIf', [1, 2, 3])]);
    assert.equal(verifyPng(tail), null);
    const fatEnd = Uint8Array.from([...SIG, ...ihdr(), ...chunk('IDAT', [1]), ...chunk('IEND', [9])]);
    assert.equal(verifyPng(fatEnd), null);
  });
});
