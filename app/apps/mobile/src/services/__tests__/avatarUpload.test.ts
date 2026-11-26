import { describe, it, expect, vi, beforeEach } from 'vitest';

const { picker, encoder, uploader, storageBucket, client, platform } = vi.hoisted(() => {
  const storageBucket = {
    upload: vi.fn(),
    remove: vi.fn(),
  };
  return {
    picker: {
      getMediaLibraryPermissionsAsync: vi.fn(),
      requestMediaLibraryPermissionsAsync: vi.fn(),
      getCameraPermissionsAsync: vi.fn(),
      requestCameraPermissionsAsync: vi.fn(),
      launchImageLibraryAsync: vi.fn(),
      launchCameraAsync: vi.fn(),
    },
    encoder: { encodeJpeg: vi.fn() },
    uploader: { uploadStorageObject: vi.fn() },
    storageBucket,
    client: { storage: { from: vi.fn(() => storageBucket) } },
    platform: { OS: 'ios' },
  };
});

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-image-picker', () => picker);
vi.mock('expo-image-manipulator', () => ({ SaveFormat: { JPEG: 'jpeg' } }));
let uuid = 0;
vi.mock('expo-crypto', () => ({ randomUUID: () => `g${++uuid}` }));
vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => client }));
// The file host the storage door builds public addresses on.
vi.mock('../../lib/supabasePublicConfig', () => ({ getSupabasePublicEnv: () => ({ url: 'https://p.supabase.co', anonKey: 'anon' }) }));
vi.mock('../imageEncoding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../imageEncoding')>()),
  encodeJpeg: encoder.encodeJpeg,
}));
vi.mock('../storageObjectUpload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storageObjectUpload')>()),
  uploadStorageObject: uploader.uploadStorageObject,
}));

import { avatarPathFromUrl, isCameraAvailable, pickAvatarImage, removeUploadedAvatar, resizeAndUploadAvatar } from '../avatarUpload';

const asset = { uri: 'file://a.jpg', width: 1200, height: 800 };

beforeEach(() => vi.clearAllMocks());

describe('pickAvatarImage', () => {
  it('reports the camera as available off the web', () => {
    expect(isCameraAvailable).toBe(true);
  });

  it('returns the camera capture when permission is granted', async () => {
    picker.getCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    picker.launchCameraAsync.mockResolvedValueOnce({ canceled: false, assets: [asset] });
    await expect(pickAvatarImage('camera')).resolves.toEqual({ status: 'ok', value: { ...asset, fileSize: null } });
    picker.launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
    await expect(pickAvatarImage('camera')).resolves.toEqual({ status: 'cancelled' });
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns blocked without opening Settings when camera access will not be re-prompted', async () => {
    picker.getCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(pickAvatarImage('camera')).resolves.toEqual({ status: 'blocked', kind: 'camera' });
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('returns denied silently when the camera prompt can be shown again and is refused', async () => {
    picker.getCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    await expect(pickAvatarImage('camera')).resolves.toEqual({ status: 'denied' });
  });

  it('picks one gallery image, or cancelled on dismiss', async () => {
    picker.getMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [{ ...asset, fileSize: 7 }] });
    await expect(pickAvatarImage('gallery')).resolves.toEqual({ status: 'ok', value: { ...asset, fileSize: 7 } });
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
    await expect(pickAvatarImage('gallery')).resolves.toEqual({ status: 'cancelled' });
  });

  it('does not open Settings after a gallery denial, and reports blocked on a later tap', async () => {
    picker.getMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true });
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false });
    await expect(pickAvatarImage('gallery')).resolves.toEqual({ status: 'denied' });
    picker.getMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false });
    await expect(pickAvatarImage('gallery')).resolves.toEqual({ status: 'blocked', kind: 'mediaLibrary' });
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });
});

describe('resizeAndUploadAvatar', () => {
  it('requires a user id', async () => {
    await expect(resizeAndUploadAvatar({ ...asset, fileSize: null }, '')).rejects.toThrow('userId is required');
  });

  const enc = (size: number, uri: string) => ({ uri, width: size, height: size, bytes: new Uint8Array([0xff, 0xd8, 0xff]) });
  type UploadCall = { pathForAttempt: (n: number) => string; attempts?: number; bucket: string };
  const storedAt = (attempt: number) => async (u: UploadCall) => u.pathForAttempt(attempt);

  it('stores a NEW object per upload (never a fixed path), its thumb beside it, and returns its URL', async () => {
    encoder.encodeJpeg.mockResolvedValueOnce(enc(512, 'file://full.jpg')).mockResolvedValueOnce(enc(96, 'file://thumb.jpg'));
    uploader.uploadStorageObject.mockImplementation(storedAt(1));
    const url = await resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1');
    expect(url).toMatch(/\/avatars\/u1\/avatar-g\d+\.jpg$/);
    expect(encoder.encodeJpeg).toHaveBeenNthCalledWith(
      1,
      'file://a.jpg',
      [{ crop: { originX: 200, originY: 0, width: 800, height: 800 } }, { resize: { width: 512, height: 512 } }],
      0.85,
    );
    expect(encoder.encodeJpeg).toHaveBeenNthCalledWith(2, 'file://full.jpg', [{ resize: { width: 96 } }], 0.75);
    const [photo, thumb] = uploader.uploadStorageObject.mock.calls.map((c) => c[0] as UploadCall);
    const stored = new URL(url).pathname.split('/avatars/')[1];
    expect(thumb?.pathForAttempt(1)).toBe(stored?.replace('.jpg', '-thumb.jpg'));
    expect(thumb?.attempts).toBe(1);
    expect(photo?.bucket).toBe('avatars');
    expect('upsert' in (photo as object)).toBe(false);
  });

  it('a timed-out older upload landing late can not overwrite a newer avatar: every attempt has its own path', async () => {
    encoder.encodeJpeg.mockResolvedValue(enc(512, 'file://full.jpg'));
    // Upload A: attempt 1 timed out (its write may still land), attempt 2 was confirmed.
    uploader.uploadStorageObject.mockImplementationOnce(storedAt(2)).mockImplementationOnce(storedAt(1));
    const first = await resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1');
    const firstCall = uploader.uploadStorageObject.mock.calls[0]?.[0] as UploadCall;
    // Upload B, later.
    uploader.uploadStorageObject.mockImplementation(storedAt(1));
    const second = await resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1');
    const lateWriterPath = firstCall.pathForAttempt(1);
    const paths = [lateWriterPath, new URL(first).pathname, new URL(second).pathname].map((p) => p.split('/').pop());
    expect(new Set(paths).size).toBe(3);
  });

  it('passes the caller\'s abort signal to the photo and thumb uploads', async () => {
    encoder.encodeJpeg.mockResolvedValue(enc(512, 'file://full.jpg'));
    uploader.uploadStorageObject.mockImplementation(storedAt(1));
    const controller = new AbortController();
    await resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1', { signal: controller.signal });
    const signals = uploader.uploadStorageObject.mock.calls.map((c) => (c[0] as { signal?: AbortSignal }).signal);
    expect(signals).toEqual([controller.signal, controller.signal]);
  });

  it('throws on a failed photo upload or a failed encode', async () => {
    encoder.encodeJpeg.mockResolvedValue(enc(512, 'file://full.jpg'));
    uploader.uploadStorageObject.mockRejectedValueOnce({ status: 403, message: 'denied' });
    await expect(resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1')).rejects.toThrow('avatar_upload: denied');
    encoder.encodeJpeg.mockRejectedValue(new Error('image_encode: manipulator returned no base64 payload'));
    await expect(resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1')).rejects.toThrow('no base64 payload');
  });

  it('only warns when the thumb upload fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    encoder.encodeJpeg.mockResolvedValue(enc(512, 'file://full.jpg'));
    uploader.uploadStorageObject.mockImplementationOnce(storedAt(1)).mockRejectedValueOnce({ status: 500, message: 'thumb' });
    await expect(resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1')).resolves.toContain('/avatars/u1/avatar-');
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

  it('also removes the generation the profile points to, and never a path outside the member\'s folder', async () => {
    storageBucket.remove.mockResolvedValue({ error: null });
    await removeUploadedAvatar('u1', 'https://p.supabase.co/storage/v1/object/public/avatars/u1/avatar-g7.jpg?v=1');
    expect(storageBucket.remove).toHaveBeenLastCalledWith(['u1/avatar.jpg', 'u1/avatar-thumb.jpg', 'u1/avatar-g7.jpg', 'u1/avatar-g7-thumb.jpg']);
    expect(avatarPathFromUrl('https://p.supabase.co/storage/v1/object/public/avatars/u2/avatar-x.jpg', 'u1')).toBeNull();
    expect(avatarPathFromUrl('https://p.supabase.co/storage/v1/object/public/avatars/u1/../u2/a.jpg', 'u1')).toBeNull();
    expect(avatarPathFromUrl('https://lh3.googleusercontent.com/a/photo', 'u1')).toBeNull();
    expect(avatarPathFromUrl(null, 'u1')).toBeNull();
  });

  it('swallows a storage error with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storageBucket.remove.mockResolvedValue({ error: { message: 'gone' } });
    await expect(removeUploadedAvatar('u1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('avatar_remove: gone');
    warn.mockRestore();
  });
});
