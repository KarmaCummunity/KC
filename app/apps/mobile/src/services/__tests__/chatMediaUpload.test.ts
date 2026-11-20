import { describe, it, expect, vi, beforeEach } from 'vitest';

const { picker, encoder, uploader } = vi.hoisted(() => {
const picker = {
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
};
const encoder = { encodeJpeg: vi.fn() };
const uploader = { uploadStorageObject: vi.fn() };

  return { picker, encoder, uploader };
});

vi.mock('expo-image-picker', () => picker);
vi.mock('expo-crypto', () => ({ randomUUID: () => 'obj-1' }));
vi.mock('../imageEncoding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../imageEncoding')>()),
  encodeJpeg: encoder.encodeJpeg,
}));
vi.mock('../storageObjectUpload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storageObjectUpload')>()),
  uploadStorageObject: uploader.uploadStorageObject,
}));
vi.mock('expo-image-manipulator', () => ({ SaveFormat: { JPEG: 'jpeg' } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { pickChatImage, uploadChatImageAndSend } from '../chatMediaUpload';

beforeEach(() => vi.clearAllMocks());

describe('pickChatImage', () => {
  it('returns null without permission', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(pickChatImage()).resolves.toBeNull();
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('returns null when cancelled or empty, uri otherwise', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
    await expect(pickChatImage()).resolves.toBeNull();
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [] });
    await expect(pickChatImage()).resolves.toBeNull();
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://a', width: 4, height: 3 }] });
    await expect(pickChatImage()).resolves.toEqual({ uri: 'file://a', width: 4, height: 3 });
  });
});

describe('uploadChatImageAndSend', () => {
  const picked = { uri: 'file://a', width: 4000, height: 3000 };

  it('encodes with the longer edge bounded at 1600, uploads to chat-media and sends the media payload', async () => {
    encoder.encodeJpeg.mockResolvedValue({ uri: 'file://e.jpg', width: 1600, height: 1200, bytes: new Uint8Array([1]) });
    // Storage confirms the object of the attempt it received (a fresh object id per attempt).
    uploader.uploadStorageObject.mockImplementation(async (u: { pathForAttempt: (n: number) => string }) => u.pathForAttempt(1));
    const send = vi.fn(async () => undefined);
    await uploadChatImageAndSend('c1', 'u1', picked, send);
    expect(encoder.encodeJpeg).toHaveBeenCalledWith('file://a', [{ resize: { width: 1600 } }], 0.85);
    expect(uploader.uploadStorageObject).toHaveBeenCalledWith(expect.objectContaining({
      bucket: 'chat-media',
      contentType: 'image/jpeg',
      // The bucket is private (#1064): only a private cache header, never a public URL.
      cacheControl: 'private, max-age=31536000, immutable',
    }));
    expect(send).toHaveBeenCalledWith({ type: 'image', path: 'u1/c1/obj-1.jpg', width: 1600, height: 1200 });
  });

  it('throws when encoding fails', async () => {
    encoder.encodeJpeg.mockRejectedValue(new Error('image_encode: manipulator returned no base64 payload'));
    await expect(uploadChatImageAndSend('c', 'u', picked, vi.fn())).rejects.toThrow('no base64 payload');
  });

  it('throws when upload fails and never sends the message', async () => {
    encoder.encodeJpeg.mockResolvedValue({ uri: 'f', width: 1, height: 1, bytes: new Uint8Array([1]) });
    uploader.uploadStorageObject.mockRejectedValue({ status: 413, message: 'quota' });
    const send = vi.fn();
    await expect(uploadChatImageAndSend('c', 'u', picked, send)).rejects.toThrow('chat_media_upload: quota');
    expect(send).not.toHaveBeenCalled();
  });
});
