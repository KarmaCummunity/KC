import { beforeEach, describe, expect, it, vi } from 'vitest';

const picker = vi.hoisted(() => ({
  getCameraPermissionsAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
  getMediaLibraryPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
}));
vi.mock('expo-image-picker', () => picker);

import { blockedPick, ensureMediaPermission, isBlockedMediaPick } from '../mediaPermissions';

beforeEach(() => vi.clearAllMocks());

describe('ensureMediaPermission', () => {
  it('returns granted without requesting when the OS already allowed access', async () => {
    picker.getMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    await expect(ensureMediaPermission('mediaLibrary')).resolves.toBe('granted');
    expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns blocked without requesting when the OS will not ask again', async () => {
    picker.getCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(ensureMediaPermission('camera')).resolves.toBe('blocked');
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it('requests only when the OS can still prompt, and maps a denial silently', async () => {
    picker.getMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(ensureMediaPermission('mediaLibrary')).resolves.toBe('denied');
    expect(picker.requestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('returns granted when the user allows the system prompt', async () => {
    picker.getCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    await expect(ensureMediaPermission('camera')).resolves.toBe('granted');
  });
});

describe('MediaPickResult helpers', () => {
  it('identifies a blocked pick', () => {
    expect(isBlockedMediaPick(blockedPick('camera'))).toBe(true);
    expect(isBlockedMediaPick({ status: 'denied' })).toBe(false);
    expect(isBlockedMediaPick({ status: 'ok', value: 1 })).toBe(false);
  });
});
