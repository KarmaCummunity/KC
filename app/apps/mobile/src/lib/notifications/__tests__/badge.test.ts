import { describe, it, expect, vi, beforeEach } from 'vitest';

const setBadgeSpy = vi.fn((_count: number) => Promise.resolve());
const platform = vi.hoisted(() => ({ OS: 'ios' }));
const permission = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-notifications', () => ({ getPermissionsAsync: permission.get, setBadgeCountAsync: (n: number) => setBadgeSpy(n) }));

import { syncAppBadge } from '../badge';

beforeEach(() => {
  setBadgeSpy.mockClear();
  permission.get.mockReset().mockResolvedValue({ status: 'granted', ios: { status: 2, allowsBadge: true } });
  platform.OS = 'ios';
});

describe('syncAppBadge', () => {
  it('sets the app icon badge to the unread count from the database', async () => {
    await syncAppBadge(7);
    expect(setBadgeSpy).toHaveBeenCalledWith(7);
  });

  it('clears the badge at zero (everything read, or signed out)', async () => {
    await syncAppBadge(0);
    expect(setBadgeSpy).toHaveBeenCalledWith(0);
  });

  it('never sets a negative, fractional or non-numeric badge', async () => {
    await syncAppBadge(-3);
    await syncAppBadge(2.9);
    await syncAppBadge(Number.NaN);
    expect(setBadgeSpy.mock.calls.map(([n]) => n)).toEqual([0, 2, 0]);
  });

  it('does nothing on web, which has no app icon badge', async () => {
    platform.OS = 'web';
    await syncAppBadge(4);
    expect(setBadgeSpy).not.toHaveBeenCalled();
  });

  it('swallows a platform failure', async () => {
    setBadgeSpy.mockRejectedValueOnce(new Error('denied'));
    await expect(syncAppBadge(1)).resolves.toBeUndefined();
  });
});

describe('badge consent', () => {
  for (const status of ['denied', 'undetermined']) {
    it(`does not set a positive badge when permission is ${status}`, async () => {
      permission.get.mockResolvedValue({ status });
      await syncAppBadge(3);
      expect(setBadgeSpy).not.toHaveBeenCalled();
    });
  }
  it('requires explicit authorization and badge permission', async () => {
    permission.get.mockResolvedValue({ status: 'granted', ios: { status: 3, allowsBadge: true } });
    await syncAppBadge(3);
    permission.get.mockResolvedValue({ status: 'granted', ios: { status: 2, allowsBadge: false } });
    await syncAppBadge(3);
    expect(setBadgeSpy).not.toHaveBeenCalled();
  });
  it('does not write a positive badge when permission lookup fails', async () => {
    permission.get.mockRejectedValue(new Error('unavailable'));
    await syncAppBadge(2);
    expect(setBadgeSpy).not.toHaveBeenCalled();
  });
  it('still clears an old badge after consent is revoked', async () => {
    permission.get.mockResolvedValue({ status: 'denied' });
    await syncAppBadge(0);
    expect(setBadgeSpy).toHaveBeenCalledWith(0);
  });
});
