// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const { openURL, platform, flag } = vi.hoisted(() => ({ openURL: vi.fn(), platform: { current: 'ios' }, flag: { current: false } }));
vi.mock('react-native', () => ({ Linking: { openURL }, Platform: { get OS() { return platform.current; } } }));
vi.mock('../useFeatureFlag', () => ({ useFeatureFlag: () => flag.current }));
vi.mock('../../config/featureFlags', () => ({
  buildExternalDonationUrl: (base: string, kind: string, org: string, listing?: string | null) => `${base}/${kind}/${org}${listing ? `?listingId=${listing}` : ''}`,
  shouldOpenDonationsExternally: (os: string, inApp: boolean) => os === 'ios' && !inApp,
  webBaseUrl: () => 'https://example.test/',
}));
import { useExternalDonations } from '../useExternalDonations';

afterEach(() => { cleanup(); vi.clearAllMocks(); platform.current = 'ios'; flag.current = false; });

describe('useExternalDonations', () => {
  it('opens a donation externally with the built URL when iOS in-app donations are off', () => {
    const { result } = renderHook(() => useExternalDonations());
    expect(result.current.external).toBe(true);
    result.current.openExternal('donate', 'org-1', 'listing-2');
    expect(openURL).toHaveBeenCalledWith('https://example.test//donate/org-1?listingId=listing-2');
  });

  it('omits a listing id for standing orders and opens nothing until requested', () => {
    const { result } = renderHook(() => useExternalDonations());
    expect(openURL).not.toHaveBeenCalled();
    result.current.openExternal('standing-order', 'org-1', null);
    expect(openURL).toHaveBeenCalledWith('https://example.test//standing-order/org-1');
  });

  it('keeps donations in-app when enabled and on non-iOS platforms', () => {
    flag.current = true;
    expect(renderHook(() => useExternalDonations()).result.current.external).toBe(false);
    cleanup();
    flag.current = false;
    platform.current = 'android';
    expect(renderHook(() => useExternalDonations()).result.current.external).toBe(false);
  });
});
