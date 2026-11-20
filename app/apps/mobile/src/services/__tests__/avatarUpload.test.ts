import { describe, it, expect, vi, beforeEach } from 'vitest';

const { picker, encoder, uploader, storageBucket, client, confirm, linking, platform } = vi.hoisted(() => {
  const storageBucket = {
    upload: vi.fn(),
    remove: vi.fn(),
    getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://cdn/avatars/u1/avatar.jpg' } })),
  };
  return {
    picker: {
      requestMediaLibraryPermissionsAsync: vi.fn(),
      requestCameraPermissionsAsync: vi.fn(),
      launchImageLibraryAsync: vi.fn(),
      launchCameraAsync: vi.fn(),
    },
    encoder: { encodeJpeg: vi.fn() },
    uploader: { uploadStorageObject: vi.fn() },
    storageBucket,
    client: { storage: { from: vi.fn(() => storageBucket) } },
    confirm: vi.fn(),
    linking: { openSettings: vi.fn() },
    platform: { OS: 'ios' },
  };
});

vi.mock('react-native', () => ({ Linking: linking, Platform: platform }));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../platformConfirm', () => ({ confirmAction: confirm }));
vi.mock('expo-image-picker', () => picker);
vi.mock('expo-image-manipulator', () => ({ SaveFormat: { JPEG: 'jpeg' } }));
vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => client }));
vi.mock('../imageEncoding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../imageEncoding')>()),
  encodeJpeg: encoder.encodeJpeg,
}));
vi.mock('../storageObjectUpload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storageObjectUpload')>()),
  uploadStorageObject: uploader.uploadStorageObject,
}));

import { isCameraAvailable, pickAvatarImage, removeUploadedAvatar, resizeAndUploadAvatar } from '../avatarUpload';

const asset = { uri: 'file://a.jpg', width: 1200, height: 800 };

beforeEach(() => vi.clearAllMocks());

describe('pickAvatarImage', () => {
  it('reports the camera as available off the web', () => {
    expect(isCameraAvailable).toBe(true);
  });

  it('returns the camera capture when permission is granted', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchCameraAsync.mockResolvedValueOnce({ canceled: false, assets: [asset] });
    await expect(pickAvatarImage('camera')).resolves.toEqual({ ...asset, fileSize: null });
    picker.launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
    await expect(pickAvatarImage('camera')).resolves.toBeNull();
  });

  it('offers the settings page when camera access is permanently denied', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    confirm.mockResolvedValue(true);
    await expect(pickAvatarImage('camera')).resolves.toBeNull();
    expect(confirm).toHaveBeenCalledWith(
      'errors.media.cameraDeniedTitle',
      'errors.media.cameraDeniedBodyAvatar',
      { confirmLabel: 'errors.media.openSettings' },
    );
    expect(linking.openSettings).toHaveBeenCalledTimes(1);
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('returns null silently when the camera prompt can be shown again', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    await expect(pickAvatarImage('camera')).resolves.toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('picks one gallery image, or null on cancel', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [{ ...asset, fileSize: 7 }] });
    await expect(pickAvatarImage('gallery')).resolves.toEqual({ ...asset, fileSize: 7 });
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
    await expect(pickAvatarImage('gallery')).resolves.toBeNull();
  });

  it('handles a denied gallery permission without opening settings unless confirmed', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true });
    await expect(pickAvatarImage('gallery')).resolves.toBeNull();
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false });
    confirm.mockResolvedValueOnce(false);
    await expect(pickAvatarImage('gallery')).resolves.toBeNull();
    expect(linking.openSettings).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });
});

describe('resizeAndUploadAvatar', () => {
  it('requires a user id', async () => {
    await expect(resizeAndUploadAvatar({ ...asset, fileSize: null }, '')).rejects.toThrow('userId is required');
  });

  const enc = (size: number, uri: string) => ({ uri, width: size, height: size, bytes: new Uint8Array([0xff, 0xd8, 0xff]) });

  it('center-crops once, derives the thumb from the 512 encode, uploads both and returns a cache-busted URL', async () => {
    encoder.encodeJpeg.mockResolvedValueOnce(enc(512, 'file://full.jpg')).mockResolvedValueOnce(enc(96, 'file://thumb.jpg'));
    uploader.uploadStorageObject.mockResolvedValue(undefined);
    const url = await resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1');
    expect(url).toMatch(/^https:\/\/cdn\/avatars\/u1\/avatar\.jpg\?v=\d+$/);
    expect(encoder.encodeJpeg).toHaveBeenNthCalledWith(
      1,
      'file://a.jpg',
      [{ crop: { originX: 200, originY: 0, width: 800, height: 800 } }, { resize: { width: 512, height: 512 } }],
      0.85,
    );
    expect(encoder.encodeJpeg).toHaveBeenNthCalledWith(2, 'file://full.jpg', [{ resize: { width: 96 } }], 0.75);
    const stored = uploader.uploadStorageObject.mock.calls.map((c) => c[0]);
    expect(stored.map((u) => u.path).sort()).toEqual(['u1/avatar-thumb.jpg', 'u1/avatar.jpg']);
    expect(stored.every((u) => u.bucket === 'avatars' && u.upsert === true)).toBe(true);
  });

  it('throws on a failed full upload or a failed encode', async () => {
    encoder.encodeJpeg.mockResolvedValue(enc(512, 'file://full.jpg'));
    uploader.uploadStorageObject.mockImplementation(async (u: { path: string }) => {
      if (u.path === 'u1/avatar.jpg') throw { status: 403, message: 'denied' };
    });
    await expect(resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1')).rejects.toThrow('avatar_upload: denied');
    encoder.encodeJpeg.mockRejectedValue(new Error('image_encode: manipulator returned no base64 payload'));
    await expect(resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1')).rejects.toThrow('no base64 payload');
  });

  it('only warns when the thumb upload fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    encoder.encodeJpeg.mockResolvedValue(enc(512, 'file://full.jpg'));
    uploader.uploadStorageObject.mockImplementation(async (u: { path: string }) => {
      if (u.path === 'u1/avatar-thumb.jpg') throw { status: 500, message: 'thumb' };
    });
    await expect(resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1')).resolves.toContain('?v=');
    expect(warn).toHaveBeenCalledWith('avatar_upload_thumb: thumb');
    warn.mockRestore();
  });
});

describe('removeUploadedAvatar', () => {
  it('removes the avatar and its thumb, and ignores an empty user id', async () => {
    await removeUploadedAvatar('');
    expect(storageBucket.remove).not.toHaveBeenCalled();
    storageBucket.remove.mockResolvedValue({ error: null });
    await removeUploadedAvatar('u1');
    expect(storageBucket.remove).toHaveBeenCalledWith(['u1/avatar.jpg', 'u1/avatar-thumb.jpg']);
  });

  it('swallows a storage error with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storageBucket.remove.mockResolvedValue({ error: { message: 'gone' } });
    await expect(removeUploadedAvatar('u1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('avatar_remove: gone');
    warn.mockRestore();
  });
});
