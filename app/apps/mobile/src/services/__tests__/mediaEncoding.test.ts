import { describe, expect, it } from 'vitest';
import { base64ToUint8Array } from '../mediaEncoding';

describe('base64ToUint8Array', () => {
  it('decodes a block with no padding', () => {
    expect(Array.from(base64ToUint8Array('TWFu'))).toEqual([77, 97, 110]);
  });

  it('drops one padded byte', () => {
    expect(Array.from(base64ToUint8Array('TWE='))).toEqual([77, 97]);
  });

  it('drops two padded bytes', () => {
    expect(Array.from(base64ToUint8Array('TQ=='))).toEqual([77]);
  });

  it('returns an empty array for an empty string', () => {
    expect(base64ToUint8Array('')).toHaveLength(0);
  });

  it('round-trips arbitrary binary, including + and / digits', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => (i * 37) % 256);
    const encoded = Buffer.from(bytes).toString('base64');
    expect(encoded).toMatch(/[+/]/);
    expect(Array.from(base64ToUint8Array(encoded))).toEqual(Array.from(bytes));
  });
});
