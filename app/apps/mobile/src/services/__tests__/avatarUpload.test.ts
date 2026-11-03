import { describe, it, expect, vi, beforeEach } from 'vitest';

const { picker, manipulator, storageBucket, client, confirm, linking, platform } = vi.hoisted(() => {
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
    manipulator: { manipulateAsync: vi.fn(), SaveFormat: { JPEG: 'jpeg' } },
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
vi.mock('expo-image-manipulator', () => manipulator);
vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => client }));
vi.mock('../mediaEncoding', () => ({ base64ToUint8Array: () => new Uint8Array([1, 2]) }));

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

  it('center-crops, uploads the full image and the thumb, and returns a cache-busted URL', async () => {
    manipulator.manipulateAsync.mockResolvedValue({ base64: 'AAA' });
    storageBucket.upload.mockResolvedValue({ error: null });
    const url = await resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1');
    expect(url).toMatch(/^https:\/\/cdn\/avatars\/u1\/avatar\.jpg\?v=\d+$/);
    expect(manipulator.manipulateAsync).toHaveBeenNthCalledWith(
      1,
      'file://a.jpg',
      [{ crop: { originX: 200, originY: 0, width: 800, height: 800 } }, { resize: { width: 512, height: 512 } }],
      expect.objectContaining({ compress: 0.85 }),
    );
    expect(storageBucket.upload).toHaveBeenNthCalledWith(1, 'u1/avatar.jpg', expect.any(Uint8Array), expect.objectContaining({ upsert: true }));
    expect(storageBucket.upload).toHaveBeenNthCalledWith(2, 'u1/avatar-thumb.jpg', expect.any(Uint8Array), expect.objectContaining({ upsert: true }));
  });

  it('throws on a failed full upload or an empty manipulator payload', async () => {
    manipulator.manipulateAsync.mockResolvedValue({ base64: 'AAA' });
    storageBucket.upload.mockResolvedValueOnce({ error: { message: 'denied' } });
    await expect(resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1')).rejects.toThrow('avatar_upload: denied');
    manipulator.manipulateAsync.mockResolvedValue({ base64: undefined });
    await expect(resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1')).rejects.toThrow('no base64 payload');
  });

  it('only warns when the thumb upload fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    manipulator.manipulateAsync.mockResolvedValue({ base64: 'AAA' });
    storageBucket.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'thumb' } });
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
