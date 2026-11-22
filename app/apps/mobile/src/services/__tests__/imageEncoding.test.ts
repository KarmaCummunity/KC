import { beforeEach, describe, expect, it, vi } from 'vitest';

const { manipulator, fileBytes, platform } = vi.hoisted(() => ({
  manipulator: { manipulateAsync: vi.fn(), SaveFormat: { JPEG: 'jpeg' } },
  fileBytes: vi.fn(),
  platform: { OS: 'ios' as string },
}));

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-image-manipulator', () => manipulator);
vi.mock('expo-file-system', () => ({
  File: class {
    constructor(readonly uri: string) {}
    bytes() {
      return fileBytes(this.uri);
    }
  },
}));
vi.mock('../mediaEncoding', () => ({ base64ToUint8Array: () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]) }));

import { encodeJpeg, looksLikeJpeg, planMaxEdgeResize } from '../imageEncoding';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]);

beforeEach(() => {
  vi.clearAllMocks();
  platform.OS = 'ios';
});

describe('planMaxEdgeResize', () => {
  it('bounds the longer edge: width for landscape, height for portrait', () => {
    expect(planMaxEdgeResize({ width: 4000, height: 3000 }, 2048)).toEqual([{ resize: { width: 2048 } }]);
    expect(planMaxEdgeResize({ width: 3000, height: 4000 }, 2048)).toEqual([{ resize: { height: 2048 } }]);
    expect(planMaxEdgeResize({ width: 3000, height: 3000 }, 400)).toEqual([{ resize: { width: 400 } }]);
  });

  it('never upscales an image already within bounds', () => {
    expect(planMaxEdgeResize({ width: 800, height: 600 }, 2048)).toEqual([]);
    expect(planMaxEdgeResize({ width: 2048, height: 1024 }, 2048)).toEqual([]);
  });

  it('falls back to bounding the width when dimensions are unknown', () => {
    expect(planMaxEdgeResize({ width: 0, height: 0 }, 2048)).toEqual([{ resize: { width: 2048 } }]);
    expect(planMaxEdgeResize({ width: Number.NaN, height: 10 }, 400)).toEqual([{ resize: { width: 400 } }]);
  });
});

describe('looksLikeJpeg', () => {
  it('accepts the JPEG signature and rejects empty or other payloads', () => {
    expect(looksLikeJpeg(JPEG)).toBe(true);
    expect(looksLikeJpeg(new Uint8Array(0))).toBe(false);
    expect(looksLikeJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(looksLikeJpeg(null)).toBe(false);
  });
});

describe('encodeJpeg', () => {
  it('encodes without base64 and reads the bytes natively from the output file', async () => {
    manipulator.manipulateAsync.mockResolvedValue({ uri: 'file://out.jpg', width: 2048, height: 1536 });
    fileBytes.mockResolvedValue(JPEG);
    const out = await encodeJpeg('file://in.jpg', [{ resize: { width: 2048 } }], 0.85);
    expect(manipulator.manipulateAsync).toHaveBeenCalledTimes(1);
    expect(manipulator.manipulateAsync).toHaveBeenCalledWith('file://in.jpg', [{ resize: { width: 2048 } }], { compress: 0.85, format: 'jpeg' });
    expect(fileBytes).toHaveBeenCalledWith('file://out.jpg');
    expect(out).toEqual({ uri: 'file://out.jpg', width: 2048, height: 1536, bytes: JPEG });
  });

  it('falls back to the base64 path when the native read returns an empty payload (iOS empty-blob class)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    manipulator.manipulateAsync
      .mockResolvedValueOnce({ uri: 'file://out.jpg', width: 10, height: 10 })
      .mockResolvedValueOnce({ uri: 'file://out2.jpg', width: 10, height: 10, base64: 'AAA' });
    fileBytes.mockResolvedValue(new Uint8Array(0));
    const out = await encodeJpeg('file://in.jpg', [], 0.7);
    expect(manipulator.manipulateAsync).toHaveBeenLastCalledWith('file://in.jpg', [], { compress: 0.7, format: 'jpeg', base64: true });
    expect(looksLikeJpeg(out.bytes)).toBe(true);
    expect(out.uri).toBe('file://out2.jpg');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back when the native read throws, and fails clearly when there is no payload at all', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    manipulator.manipulateAsync
      .mockResolvedValueOnce({ uri: 'file://out.jpg', width: 1, height: 1 })
      .mockResolvedValueOnce({ uri: 'file://out.jpg', width: 1, height: 1, base64: undefined });
    fileBytes.mockRejectedValue(new Error('no module'));
    await expect(encodeJpeg('file://in.jpg', [], 0.8)).rejects.toThrow('no base64 payload');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('reads the encoded blob through fetch on the web', async () => {
    platform.OS = 'web';
    manipulator.manipulateAsync.mockResolvedValue({ uri: 'blob:x', width: 5, height: 5 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JPEG));
    const out = await encodeJpeg('blob:in', [], 0.85);
    expect(fetchSpy).toHaveBeenCalledWith('blob:x');
    expect(Array.from(out.bytes)).toEqual(Array.from(JPEG));
    expect(fileBytes).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
