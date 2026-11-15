// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

let flag = false;
let isPro: boolean | undefined = false;
let packages: Array<{ id: string; priceString: string }> = [];
const track = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <span>redirect:{href}</span>,
  Stack: { Screen: () => null },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { price?: string }) => (o?.price ? `${k}:${o.price}` : k) }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[0] === 'is-pro'
      ? { data: isPro, isLoading: isPro === undefined, isSuccess: isPro !== undefined }
      : { data: packages, isLoading: false, isSuccess: true },
}));
vi.mock('react-native', () => ({
  ActivityIndicator: () => <i>spinner</i>,
  Alert: { alert: vi.fn() },
  Linking: { openURL: vi.fn() },
  Pressable: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Platform: { OS: 'ios' },
}));
vi.mock('@kc/ui', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  makeUseStyles: () => () => new Proxy({}, { get: () => ({}) }),
  radius: {}, spacing: {}, typography: {},
}));
vi.mock('../../../hooks/useFeatureFlag', () => ({ useFeatureFlag: () => flag }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ session: { userId: 'u1' } }),
}));
vi.mock('../../../lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));
vi.mock('../../../lib/rtlTextAlignStart', () => ({ rtlTextAlignStart: 'left' }));
vi.mock('../../../lib/webRtlStyle', () => ({ webTextRtl: {}, webViewRtl: {} }));
vi.mock('../../marketplaceComposition', () => ({ getMarketplaceSupabaseClient: () => ({}) }));
vi.mock('../revenuecat', () => ({
  getProPackages: vi.fn(),
  purchaseProPackage: vi.fn(),
  restoreProPurchases: vi.fn(),
  manageSubscriptionUrl: () => 'https://store.example/subs',
}));

async function screen() {
  const { default: Screen } = await import('../../../../app/pro');
  return render(<Screen />).container.textContent ?? '';
}

describe('ProPaywallScreen', () => {
  beforeEach(() => {
    flag = true;
    isPro = false;
    packages = [];
    track.mockClear();
  });

  it('redirects home while the pro_paywall flag is off', async () => {
    flag = false;
    expect(await screen()).toBe('redirect:/');
  });

  it('shows the store price on the subscribe button and logs paywall_viewed', async () => {
    packages = [{ id: 'monthly', priceString: '$19.99' }];
    const text = await screen();
    expect(text).toContain('karma.proSubscribe:$19.99');
    expect(text).toContain('karma.proRestore');
    expect(text).toContain('karma.proAutoRenew');
    expect(track).toHaveBeenCalledWith('paywall_viewed');
  });

  it('shows an unavailable note when the store has no packages', async () => {
    expect(await screen()).toContain('karma.proUnavailable');
  });

  it('shows status instead of the paywall for Pro users', async () => {
    isPro = true;
    const text = await screen();
    expect(text).toContain('karma.proActiveTitle');
    expect(text).not.toContain('karma.proSubscribe');
    expect(track).not.toHaveBeenCalled();
  });
});
