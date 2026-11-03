import { describe, it, expect, vi, beforeEach } from 'vitest';

const { picker, manipulator, storageBucket, client, confirm, linking, bytes } = vi.hoisted(() => {
  const storageBucket = { upload: vi.fn() };
  return {
    picker: { requestMediaLibraryPermissionsAsync: vi.fn(), launchImageLibraryAsync: vi.fn() },
    manipulator: { manipulateAsync: vi.fn(), SaveFormat: { JPEG: 'jpeg' } },
    storageBucket,
    client: { storage: { from: vi.fn(() => storageBucket) } },
    confirm: vi.fn(),
    linking: { openSettings: vi.fn() },
    // Encoded size per call; the mocked manipulator returns base64 = the byte count.
    bytes: (n: number) => new Uint8Array(n),
  };
});

vi.mock('react-native', () => ({ Linking: linking }));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../platformConfirm', () => ({ confirmAction: confirm }));
vi.mock('expo-image-picker', () => picker);
vi.mock('expo-image-manipulator', () => manipulator);
vi.mock('expo-crypto', () => ({ randomUUID: () => 'batch-1' }));
vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => client }));
vi.mock('../mediaEncoding', () => ({ base64ToUint8Array: (b64: string) => bytes(Number(b64)) }));
vi.mock('../../lib/imageUrl', () => ({
  deriveThumbPath: (p: string) => p.replace(/\.jpg$/, '-thumb.jpg'),
}));

import {
  buildPostImagePath,
  buildPostImageThumbPath,
  newUploadBatchId,
  pickPostImages,
  resizeAndUploadImage,
} from '../imageUpload';

const MB = 1024 * 1024;
const picked = { uri: 'file://p.jpg', width: 4000, height: 3000, fileSize: null };

beforeEach(() => vi.clearAllMocks());

describe('pickPostImages', () => {
  it('returns [] without asking when the media limit is reached', async () => {
    await expect(pickPostImages(5)).resolves.toEqual([]);
    expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns [] silently when permission can still be asked again', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    await expect(pickPostImages(0)).resolves.toEqual([]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('offers the settings page when permission is permanently denied', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    confirm.mockResolvedValueOnce(true);
    await expect(pickPostImages(0)).resolves.toEqual([]);
    expect(linking.openSettings).toHaveBeenCalledTimes(1);
    confirm.mockResolvedValueOnce(false);
    await pickPostImages(0);
    expect(linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('limits the selection to the remaining slots and maps the assets', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
    await expect(pickPostImages(2)).resolves.toEqual([]);
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'a', width: 1, height: 2 }, { uri: 'b', width: 3, height: 4, fileSize: 9 }],
    });
    await expect(pickPostImages(2)).resolves.toEqual([
      { uri: 'a', width: 1, height: 2, fileSize: null },
      { uri: 'b', width: 3, height: 4, fileSize: 9 },
    ]);
    expect(picker.launchImageLibraryAsync).toHaveBeenLastCalledWith(expect.objectContaining({ selectionLimit: 3 }));
  });
});

describe('buildPostImagePath', () => {
  it('builds <user>/<batch>/<ordinal>.jpg and its thumb sibling', () => {
    expect(buildPostImagePath('u1', 'b1', 0)).toBe('u1/b1/0.jpg');
    expect(buildPostImageThumbPath('u1', 'b1', 4)).toBe('u1/b1/4-thumb.jpg');
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

describe('resizeAndUploadImage', () => {
  it('uploads the full image and the thumb with immutable caching', async () => {
    manipulator.manipulateAsync.mockResolvedValueOnce({ base64: '100' }).mockResolvedValueOnce({ base64: '10' });
    storageBucket.upload.mockResolvedValue({ error: null });
    const asset = await resizeAndUploadImage(picked, 'u1', 'b1', 2);
    expect(asset).toEqual({ path: 'u1/b1/2.jpg', mimeType: 'image/jpeg', sizeBytes: 100, previewUri: 'file://p.jpg' });
    expect(client.storage.from).toHaveBeenCalledWith('post-images');
    const cache = expect.objectContaining({ cacheControl: 'public, max-age=31536000, immutable', upsert: true });
    expect(storageBucket.upload).toHaveBeenNthCalledWith(1, 'u1/b1/2.jpg', expect.any(Uint8Array), cache);
    expect(storageBucket.upload).toHaveBeenNthCalledWith(2, 'u1/b1/2-thumb.jpg', expect.any(Uint8Array), cache);
  });

  it('re-encodes at a lower quality when the first pass exceeds 5 MB', async () => {
    manipulator.manipulateAsync
      .mockResolvedValueOnce({ base64: String(6 * MB) })
      .mockResolvedValueOnce({ base64: String(4 * MB) })
      .mockResolvedValueOnce({ base64: '10' });
    storageBucket.upload.mockResolvedValue({ error: null });
    const asset = await resizeAndUploadImage(picked, 'u1', 'b1', 0);
    expect(asset.sizeBytes).toBe(4 * MB);
    expect(manipulator.manipulateAsync.mock.calls[1]?.[2]).toEqual(expect.objectContaining({ compress: 0.6 }));
  });

  it('rejects an image still over 5 MB after the fallback', async () => {
    manipulator.manipulateAsync.mockResolvedValue({ base64: String(6 * MB) });
    await expect(resizeAndUploadImage(picked, 'u1', 'b1', 0)).rejects.toThrow('too large after fallback compress');
    expect(storageBucket.upload).not.toHaveBeenCalled();
  });

  it('fails when the manipulator returns no payload', async () => {
    manipulator.manipulateAsync.mockResolvedValue({ base64: undefined });
    await expect(resizeAndUploadImage(picked, 'u1', 'b1', 0)).rejects.toThrow('no base64 payload');
  });

  it('throws on a failed full upload but tolerates a failed thumb upload', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    manipulator.manipulateAsync.mockResolvedValue({ base64: '10' });
    storageBucket.upload.mockResolvedValueOnce({ error: { message: 'quota' } });
    await expect(resizeAndUploadImage(picked, 'u1', 'b1', 1)).rejects.toThrow('upload[1]: quota');
    storageBucket.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'thumb' } });
    await expect(resizeAndUploadImage(picked, 'u1', 'b1', 1)).resolves.toMatchObject({ path: 'u1/b1/1.jpg' });
    expect(warn).toHaveBeenCalledWith('upload-thumb[1]: thumb');
    warn.mockRestore();
  });
});

describe('newUploadBatchId', () => {
  it('returns a random UUID', () => {
    expect(newUploadBatchId()).toBe('batch-1');
  });
});
