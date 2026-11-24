import { describe, it, expect, vi, beforeEach } from 'vitest';

const { picker, encoder, uploader, storageBucket, client, confirm, linking, platform } = vi.hoisted(() => {
  const storageBucket = {
    upload: vi.fn(),
    remove: vi.fn(),
    getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://p.supabase.co/storage/v1/object/public/avatars/${path}` } })),
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
let uuid = 0;
vi.mock('expo-crypto', () => ({ randomUUID: () => `g${++uuid}` }));
vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => client }));
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
  type UploadCall = { pathForAttempt: (n: number) => string; attempts?: number; bucket: string };
  const storedAt = (attempt: number) => async (u: UploadCall) => u.pathForAttempt(attempt);

  it('stores a NEW object per upload (never a fixed path), its thumb beside it, and returns its URL', async () => {
    encoder.encodeJpeg.mockResolvedValueOnce(enc(800, 'file://full.jpg')).mockResolvedValueOnce(enc(96, 'file://thumb.jpg'));
    uploader.uploadStorageObject.mockImplementation(storedAt(1));
    const url = await resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1');
    expect(url).toMatch(/\/avatars\/u1\/avatar-g\d+\.jpg$/);
    expect(encoder.encodeJpeg).toHaveBeenNthCalledWith(
      1,
      'file://a.jpg',
      [{ crop: { originX: 200, originY: 0, width: 800, height: 800 } }, { resize: { width: 800, height: 800 } }],
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

  it('encodes large photos at a 1024px maximum edge and q85', async () => {
    encoder.encodeJpeg.mockResolvedValueOnce(enc(1024, 'file://full.jpg')).mockResolvedValueOnce(enc(96, 'file://thumb.jpg'));
    uploader.uploadStorageObject.mockImplementation(storedAt(1));
    await resizeAndUploadAvatar({ uri: 'file://large.jpg', width: 4000, height: 3000, fileSize: 9_000_000 }, 'u1');
    expect(encoder.encodeJpeg).toHaveBeenNthCalledWith(1, 'file://large.jpg', [
      { crop: { originX: 500, originY: 0, width: 3000, height: 3000 } },
      { resize: { width: 1024, height: 1024 } },
    ], 0.85);
  });

  it('uses encoded byte size, accepts the exact bucket boundary and never upscales a small image', async () => {
    encoder.encodeJpeg.mockResolvedValueOnce({ ...enc(64, 'file://small.jpg'), bytes: new Uint8Array(524288) })
      .mockResolvedValueOnce(enc(64, 'file://thumb.jpg'));
    uploader.uploadStorageObject.mockImplementation(storedAt(1));
    await resizeAndUploadAvatar({ uri: 'file://small.jpg', width: 64, height: 64, fileSize: 20_000_000 }, 'u1');
    expect(encoder.encodeJpeg).toHaveBeenNthCalledWith(1, 'file://small.jpg', [
      { crop: { originX: 0, originY: 0, width: 64, height: 64 } },
      { resize: { width: 64, height: 64 } },
    ], 0.85);
    expect(encoder.encodeJpeg).toHaveBeenCalledTimes(2);
    expect((uploader.uploadStorageObject.mock.calls[0]?.[0] as { bytes: Uint8Array }).bytes.byteLength).toBe(524288);
  });

  it('shrinks an over-budget encode at q85 before upload and derives the thumb from the accepted result', async () => {
    encoder.encodeJpeg.mockResolvedValueOnce({ ...enc(1024, 'file://heavy.jpg'), bytes: new Uint8Array(524289) })
      .mockResolvedValueOnce(enc(768, 'file://accepted.jpg')).mockResolvedValueOnce(enc(96, 'file://thumb.jpg'));
    uploader.uploadStorageObject.mockImplementation(storedAt(1));
    await resizeAndUploadAvatar({ uri: 'file://large.jpg', width: 2000, height: 2000, fileSize: 1 }, 'u1');
    expect(encoder.encodeJpeg).toHaveBeenNthCalledWith(2, 'file://large.jpg', [
      { crop: { originX: 0, originY: 0, width: 2000, height: 2000 } },
      { resize: { width: 768, height: 768 } },
    ], 0.85);
    expect(encoder.encodeJpeg).toHaveBeenNthCalledWith(3, 'file://accepted.jpg', [{ resize: { width: 96 } }], 0.75);
  });

  it('fails before storage if every bounded encode exceeds the bucket limit', async () => {
    encoder.encodeJpeg.mockResolvedValue({ ...enc(1024, 'file://heavy.jpg'), bytes: new Uint8Array(524289) });
    await expect(resizeAndUploadAvatar({ uri: 'file://large.jpg', width: 3000, height: 3000, fileSize: null }, 'u1'))
      .rejects.toThrow();
    expect(encoder.encodeJpeg).toHaveBeenCalledTimes(5);
    expect(encoder.encodeJpeg.mock.calls.map((call) => call[2])).toEqual([0.85, 0.85, 0.85, 0.85, 0.85]);
    expect(uploader.uploadStorageObject).not.toHaveBeenCalled();
  });

  it.each([{ width: 0, height: 10 }, { width: Number.NaN, height: 10 }, { width: 10, height: Infinity }])(
    'rejects invalid dimensions without encoding or storage: %j', async (size) => {
      await expect(resizeAndUploadAvatar({ uri: 'file://invalid.jpg', ...size, fileSize: null }, 'u1')).rejects.toThrow();
      expect(encoder.encodeJpeg).not.toHaveBeenCalled();
      expect(uploader.uploadStorageObject).not.toHaveBeenCalled();
    },
  );

  it('a timed-out older upload landing late can not overwrite a newer avatar: every attempt has its own path', async () => {
    encoder.encodeJpeg.mockResolvedValue(enc(800, 'file://full.jpg'));
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
    encoder.encodeJpeg.mockResolvedValue(enc(800, 'file://full.jpg'));
    uploader.uploadStorageObject.mockImplementation(storedAt(1));
    const controller = new AbortController();
    await resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1', { signal: controller.signal });
    const signals = uploader.uploadStorageObject.mock.calls.map((c) => (c[0] as { signal?: AbortSignal }).signal);
    expect(signals).toEqual([controller.signal, controller.signal]);
  });

  it('throws on a failed photo upload or a failed encode', async () => {
    encoder.encodeJpeg.mockResolvedValue(enc(800, 'file://full.jpg'));
    uploader.uploadStorageObject.mockRejectedValueOnce({ status: 403, message: 'denied' });
    await expect(resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1')).rejects.toThrow('avatar_upload: denied');
    encoder.encodeJpeg.mockRejectedValue(new Error('image_encode: manipulator returned no base64 payload'));
    await expect(resizeAndUploadAvatar({ ...asset, fileSize: null }, 'u1')).rejects.toThrow('no base64 payload');
  });

  it('only warns when the thumb upload fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    encoder.encodeJpeg.mockResolvedValue(enc(800, 'file://full.jpg'));
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
