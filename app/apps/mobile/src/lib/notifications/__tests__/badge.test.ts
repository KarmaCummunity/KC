import { describe, it, expect, vi, beforeEach } from 'vitest';

const setBadgeSpy = vi.fn((_count: number) => Promise.resolve());
const platform = vi.hoisted(() => ({ OS: 'ios' }));

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-notifications', () => ({ setBadgeCountAsync: (n: number) => setBadgeSpy(n) }));

import { syncAppBadge } from '../badge';

beforeEach(() => {
  setBadgeSpy.mockClear();
  platform.OS = 'ios';
});

describe('syncAppBadge', () => {
  it('sets the app icon badge to the unread count from the database', () => {
    syncAppBadge(7);
    expect(setBadgeSpy).toHaveBeenCalledWith(7);
  });

  it('clears the badge at zero (everything read, or signed out)', () => {
    syncAppBadge(0);
    expect(setBadgeSpy).toHaveBeenCalledWith(0);
  });

  it('never sets a negative, fractional or non-numeric badge', () => {
    syncAppBadge(-3);
    syncAppBadge(2.9);
    syncAppBadge(Number.NaN);
    expect(setBadgeSpy.mock.calls.map(([n]) => n)).toEqual([0, 2, 0]);
  });

  it('does nothing on web, which has no app icon badge', () => {
    platform.OS = 'web';
    syncAppBadge(4);
    expect(setBadgeSpy).not.toHaveBeenCalled();
  });

  it('swallows a platform failure', () => {
    setBadgeSpy.mockRejectedValueOnce(new Error('denied'));
    expect(() => syncAppBadge(1)).not.toThrow();
  });
});
