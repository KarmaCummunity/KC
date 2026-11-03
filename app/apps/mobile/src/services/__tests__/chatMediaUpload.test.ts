import { describe, it, expect, vi, beforeEach } from 'vitest';

const { picker, manipulator, storageBucket, client } = vi.hoisted(() => {
const picker = {
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
};
const manipulator = { manipulateAsync: vi.fn(), SaveFormat: { JPEG: 'jpeg' } };
const storageBucket = {
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
};
const client = { storage: { from: vi.fn(() => storageBucket) } };

  return { picker, manipulator, storageBucket, client };
});

vi.mock('expo-image-picker', () => picker);
vi.mock('expo-image-manipulator', () => manipulator);
vi.mock('expo-crypto', () => ({ randomUUID: () => 'obj-1' }));
vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => client }));
vi.mock('../mediaEncoding', () => ({ base64ToUint8Array: () => new Uint8Array([1, 2]) }));

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
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://a' }] });
    await expect(pickChatImage()).resolves.toEqual({ uri: 'file://a' });
  });
});

describe('uploadChatImageAndSend', () => {
  it('uploads to chat-media and sends media rpc payload', async () => {
    manipulator.manipulateAsync.mockResolvedValue({ base64: 'AAA', width: 800, height: 600 });
    storageBucket.upload.mockResolvedValue({ error: null });
    const send = vi.fn(async () => undefined);
    await uploadChatImageAndSend('c1', 'u1', 'file://a', send);
    expect(client.storage.from).toHaveBeenCalledWith('chat-media');
    expect(storageBucket.upload).toHaveBeenCalledWith('u1/c1/obj-1.jpg', expect.any(Uint8Array), expect.objectContaining({ contentType: 'image/jpeg', upsert: false }));
    expect(send).toHaveBeenCalledWith({ type: 'image', path: 'u1/c1/obj-1.jpg', width: 800, height: 600 });
    // The bucket is private: no public URL is ever built or stored (#1064).
    expect(storageBucket.getPublicUrl).not.toHaveBeenCalled();
  });

  it('throws when encoding fails', async () => {
    manipulator.manipulateAsync.mockResolvedValue({ base64: undefined, width: 1, height: 1 });
    await expect(uploadChatImageAndSend('c', 'u', 'f', vi.fn())).rejects.toThrow('chat_media_encode_failed');
  });

  it('throws when upload fails', async () => {
    manipulator.manipulateAsync.mockResolvedValue({ base64: 'A', width: 1, height: 1 });
    storageBucket.upload.mockResolvedValue({ error: { message: 'quota' } });
    const send = vi.fn();
    await expect(uploadChatImageAndSend('c', 'u', 'f', send)).rejects.toThrow('chat_media_upload: quota');
    expect(send).not.toHaveBeenCalled();
  });
});
