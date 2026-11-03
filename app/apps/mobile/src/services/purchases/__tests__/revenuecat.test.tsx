// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

const platform = { OS: 'ios' };
vi.mock('react-native', () => ({ Platform: platform }));
const P = {
  configure: vi.fn(),
  logIn: vi.fn(async () => ({})),
  logOut: vi.fn(async () => ({})),
  isAnonymous: vi.fn(async () => false),
};
vi.mock('react-native-purchases', () => ({ default: P }));

async function fresh() {
  vi.resetModules();
  return import('../revenuecat');
}

describe('syncRevenueCatUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.OS = 'ios';
    process.env['EXPO_PUBLIC_REVENUECAT_IOS_KEY'] = 'appl_test';
  });

  it('configures with the KC user id, then logIn / logOut on changes', async () => {
    const { syncRevenueCatUser } = await fresh();
    await syncRevenueCatUser('u1');
    expect(P.configure).toHaveBeenCalledWith({ apiKey: 'appl_test', appUserID: 'u1' });
    await syncRevenueCatUser('u1');
    expect(P.logIn).not.toHaveBeenCalled();
    await syncRevenueCatUser('u2');
    expect(P.logIn).toHaveBeenCalledWith('u2');
    await syncRevenueCatUser(null);
    expect(P.logOut).toHaveBeenCalled();
  });

  it('skips logOut for anonymous users', async () => {
    const { syncRevenueCatUser } = await fresh();
    await syncRevenueCatUser('u1');
    P.isAnonymous.mockResolvedValueOnce(true);
    await syncRevenueCatUser(null);
    expect(P.logOut).not.toHaveBeenCalled();
  });

  it('is a no-op on web or without a key', async () => {
    platform.OS = 'web';
    let m = await fresh();
    await m.syncRevenueCatUser('u1');
    platform.OS = 'ios';
    process.env['EXPO_PUBLIC_REVENUECAT_IOS_KEY'] = '';
    m = await fresh();
    await m.syncRevenueCatUser('u1');
    expect(P.configure).not.toHaveBeenCalled();
  });

  it('never throws when the SDK fails', async () => {
    const { syncRevenueCatUser } = await fresh();
    P.configure.mockImplementationOnce(() => { throw new Error('boom'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(syncRevenueCatUser('u1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('RevenueCatSync', () => {
  it('syncs the session user id', async () => {
    vi.resetModules();
    const sync = vi.fn(async () => {});
    vi.doMock('../revenuecat', () => ({ syncRevenueCatUser: sync }));
    vi.doMock('../../../store/authStore', () => ({
      useAuthStore: (sel: (s: unknown) => unknown) => sel({ session: { userId: 'u9' } }),
    }));
    const { RevenueCatSync } = await import('../RevenueCatSync');
    render(<RevenueCatSync />);
    expect(sync).toHaveBeenCalledWith('u9');
  });
});
