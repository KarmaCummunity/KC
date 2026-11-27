import { describe, it, expect, vi, beforeEach } from 'vitest';

const { picker, encoder, uploader } = vi.hoisted(() => ({
  picker: {
    getMediaLibraryPermissionsAsync: vi.fn(),
    requestMediaLibraryPermissionsAsync: vi.fn(),
    launchImageLibraryAsync: vi.fn(),
  },
  encoder: { encodeJpeg: vi.fn() },
  uploader: { uploadStorageObject: vi.fn() },
}));

vi.mock('expo-image-manipulator', () => ({ SaveFormat: { JPEG: 'jpeg' } }));
vi.mock('expo-image-picker', () => picker);
vi.mock('expo-crypto', () => ({ randomUUID: () => 'batch-1' }));
vi.mock('../imageEncoding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../imageEncoding')>()),
  encodeJpeg: encoder.encodeJpeg,
}));
vi.mock('../storageObjectUpload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storageObjectUpload')>()),
  uploadStorageObject: uploader.uploadStorageObject,
}));
vi.mock('../../lib/imageUrl', () => ({
  deriveThumbPath: (p: string) => p.replace(/\.jpg$/, '-thumb.jpg'),
}));

import {
  buildPostImagePath,
  newUploadBatchId,
  pickPostImages,
  buildAttemptPath,
  resizeAndUploadImage,
  uploadPostImageBatch,
} from '../imageUpload';
import { UploadCancelledError } from '../uploadControl';

const MB = 1024 * 1024;
const picked = { uri: 'file://p.jpg', width: 4000, height: 3000, fileSize: null };

beforeEach(() => vi.clearAllMocks());

describe('pickPostImages', () => {
  it('returns an empty ok result without asking when the media limit is reached', async () => {
    await expect(pickPostImages(5)).resolves.toEqual({ status: 'ok', value: [] });
    expect(picker.getMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns denied silently when the user dismisses a still-askable prompt', async () => {
    picker.getMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    await expect(pickPostImages(0)).resolves.toEqual({ status: 'denied' });
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('returns blocked without requesting or opening Settings when the OS will not ask again', async () => {
    picker.getMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(pickPostImages(0)).resolves.toEqual({ status: 'blocked', kind: 'mediaLibrary' });
    expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('limits the selection to the remaining slots and maps the assets', async () => {
    picker.getMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
    await expect(pickPostImages(2)).resolves.toEqual({ status: 'cancelled' });
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'a', width: 1, height: 2 }, { uri: 'b', width: 3, height: 4, fileSize: 9 }],
    });
    await expect(pickPostImages(2)).resolves.toEqual({
      status: 'ok',
      value: [
        { uri: 'a', width: 1, height: 2, fileSize: null },
        { uri: 'b', width: 3, height: 4, fileSize: 9 },
      ],
    });
    expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).toHaveBeenLastCalledWith(expect.objectContaining({ selectionLimit: 3 }));
  });
});

describe('buildPostImagePath', () => {
  it('builds <user>/<batch>/<ordinal>.jpg and its thumb sibling', () => {
    expect(buildPostImagePath('u1', 'b1', 0)).toBe('u1/b1/0.jpg');
  });

  it.each([
    ['', 'b', 0, 'userId is required'],
    ['u', '', 0, 'batchUuid is required'],
    ['u', 'b', 5, 'ordinal must be 0..4'],
    ['u', 'b', 1.5, 'ordinal must be 0..4'],
    ['u', 'b', -1, 'ordinal must be 0..4'],
  ])('rejects (%j, %j, %j)', (user, batch, ordinal, message) => {
    expect(() => buildPostImagePath(user, batch, ordinal)).toThrow(message);
  });
});

/** The encoder's answer: an encoded file of `size` bytes and the given dimensions. */
const encoded = (size: number, width = 2048, height = 1536, uri = `file://enc-${size}.jpg`) => ({
  uri, width, height, bytes: new Uint8Array(size),
});

/** The uploader double: Storage confirms attempt 1 unless a test says otherwise. */
type UploadCall = { pathForAttempt: (n: number) => string; attempts?: number; signal?: AbortSignal; bucket: string; contentType: string; cacheControl: string };
const storedAt = (attempt: number) => async (u: UploadCall) => u.pathForAttempt(attempt);

describe('buildAttemptPath', () => {
  it('keeps the first attempt\'s name and gives every retry its own', () => {
    expect(buildAttemptPath('u/b/0.jpg', 1)).toBe('u/b/0.jpg');
    expect(buildAttemptPath('u/b/0.jpg', 2)).toBe('u/b/0-a2.jpg');
    expect(buildAttemptPath('u/b.x/0', 3)).toBe('u/b.x/0-a3');
  });
});

describe('resizeAndUploadImage', () => {
  beforeEach(() => {
    uploader.uploadStorageObject.mockImplementation(storedAt(1));
  });

  it('decodes the original once, derives the thumb from the 2048 encode, stores the photo then its thumb', async () => {
    encoder.encodeJpeg.mockResolvedValueOnce(encoded(100, 2048, 1536, 'file://full.jpg')).mockResolvedValueOnce(encoded(10, 400, 300));
    const asset = await resizeAndUploadImage(picked, 'u1', 'b1', 2);
    expect(asset).toEqual({ path: 'u1/b1/2.jpg', mimeType: 'image/jpeg', sizeBytes: 100, previewUri: 'file://p.jpg' });
    // Landscape 4000x3000: the longer edge (width) is bounded at 2048.
    expect(encoder.encodeJpeg).toHaveBeenNthCalledWith(1, 'file://p.jpg', [{ resize: { width: 2048 } }], 0.85);
    // The thumb is resized from the already-small full encode, not from the original.
    expect(encoder.encodeJpeg).toHaveBeenNthCalledWith(2, 'file://full.jpg', [{ resize: { width: 400 } }], 0.75);
    const [photo, thumb] = uploader.uploadStorageObject.mock.calls.map((c) => c[0] as UploadCall);
    expect(photo?.pathForAttempt(1)).toBe('u1/b1/2.jpg');
    expect(thumb?.pathForAttempt(1)).toBe('u1/b1/2-thumb.jpg');
    // The thumb's name is fixed by the stored photo: it is tried once, never rewritten.
    expect(thumb?.attempts).toBe(1);
    for (const u of [photo, thumb]) {
      expect(u).toMatchObject({ bucket: 'post-images', contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' });
    }
  });

  it('records the path of the attempt that Storage confirmed, and puts the thumb beside it', async () => {
    encoder.encodeJpeg.mockResolvedValue(encoded(10));
    uploader.uploadStorageObject.mockImplementationOnce(storedAt(2)).mockImplementationOnce(storedAt(1));
    const asset = await resizeAndUploadImage(picked, 'u1', 'b1', 0);
    expect(asset.path).toBe('u1/b1/0-a2.jpg');
    expect((uploader.uploadStorageObject.mock.calls[1]?.[0] as UploadCall).pathForAttempt(1)).toBe('u1/b1/0-a2-thumb.jpg');
  });

  it('bounds a portrait photo by its height and never upscales a small one', async () => {
    encoder.encodeJpeg.mockResolvedValue(encoded(10, 300, 400));
    await resizeAndUploadImage({ ...picked, width: 3000, height: 4000 }, 'u1', 'b1', 0);
    expect(encoder.encodeJpeg.mock.calls[0]?.[1]).toEqual([{ resize: { height: 2048 } }]);
    encoder.encodeJpeg.mockClear();
    await resizeAndUploadImage({ ...picked, width: 300, height: 200 }, 'u1', 'b1', 0);
    expect(encoder.encodeJpeg.mock.calls[0]?.[1]).toEqual([]);
    expect(encoder.encodeJpeg.mock.calls[1]?.[1]).toEqual([]);
  });

  it('re-encodes the resized file at a lower quality when the first pass exceeds 5 MB', async () => {
    encoder.encodeJpeg
      .mockResolvedValueOnce(encoded(6 * MB, 2048, 1536, 'file://big.jpg'))
      .mockResolvedValueOnce(encoded(4 * MB, 2048, 1536, 'file://smaller.jpg'))
      .mockResolvedValueOnce(encoded(10, 400, 300));
    const asset = await resizeAndUploadImage(picked, 'u1', 'b1', 0);
    expect(asset.sizeBytes).toBe(4 * MB);
    expect(encoder.encodeJpeg).toHaveBeenNthCalledWith(2, 'file://big.jpg', [], 0.6);
    expect(encoder.encodeJpeg).toHaveBeenNthCalledWith(3, 'file://smaller.jpg', [{ resize: { width: 400 } }], 0.75);
  });

  it('rejects an image still over 5 MB after the fallback, before any upload', async () => {
    encoder.encodeJpeg.mockResolvedValue(encoded(6 * MB));
    await expect(resizeAndUploadImage(picked, 'u1', 'b1', 0)).rejects.toThrow('too large after fallback compress');
    expect(uploader.uploadStorageObject).not.toHaveBeenCalled();
  });

  it('throws on a failed photo upload (without uploading a thumb) but tolerates a failed thumb', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    encoder.encodeJpeg.mockResolvedValue(encoded(10));
    uploader.uploadStorageObject.mockRejectedValueOnce({ status: 413, message: 'quota' });
    await expect(resizeAndUploadImage(picked, 'u1', 'b1', 1)).rejects.toThrow('upload[1]: quota');
    expect(uploader.uploadStorageObject).toHaveBeenCalledTimes(1);
    uploader.uploadStorageObject.mockImplementationOnce(storedAt(1)).mockRejectedValueOnce({ status: 500, message: 'thumb' });
    await expect(resizeAndUploadImage(picked, 'u1', 'b1', 1)).resolves.toMatchObject({ path: 'u1/b1/1.jpg' });
    expect(warn).toHaveBeenCalledWith('upload-thumb[1]: thumb');
    warn.mockRestore();
  });

  it('stops before encoding when cancelled, propagates a cancel, and passes the signal to every upload', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(resizeAndUploadImage(picked, 'u1', 'b1', 0, { signal: controller.signal })).rejects.toBeInstanceOf(UploadCancelledError);
    expect(encoder.encodeJpeg).not.toHaveBeenCalled();
    encoder.encodeJpeg.mockResolvedValue(encoded(10));
    uploader.uploadStorageObject.mockRejectedValueOnce(new UploadCancelledError());
    await expect(resizeAndUploadImage(picked, 'u1', 'b1', 0)).rejects.toBeInstanceOf(UploadCancelledError);
    const live = new AbortController();
    uploader.uploadStorageObject.mockClear();
    await resizeAndUploadImage(picked, 'u1', 'b1', 0, { signal: live.signal });
    expect(uploader.uploadStorageObject.mock.calls.every((c) => (c[0] as UploadCall).signal === live.signal)).toBe(true);
  });
});

describe('uploadPostImageBatch', () => {
  beforeEach(() => {
    uploader.uploadStorageObject.mockImplementation(storedAt(1));
  });

  it('uploads a pick under one fresh batch, ordinals from 0, each image settling on its own', async () => {
    encoder.encodeJpeg.mockImplementation(async (uri: string) => {
      if (uri === 'file://bad.jpg') throw new Error('decode');
      return encoded(10);
    });
    const onSettled = vi.fn();
    const results = await uploadPostImageBatch(
      [picked, { ...picked, uri: 'file://bad.jpg' }, picked],
      'u1',
      { onSettled },
    );
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.path] : []))).toEqual(['u1/batch-1/0.jpg', 'u1/batch-1/2.jpg']);
    expect(onSettled).toHaveBeenCalledTimes(3);
  });
});

describe('newUploadBatchId', () => {
  it('returns a random UUID', () => {
    expect(newUploadBatchId()).toBe('batch-1');
  });
});
