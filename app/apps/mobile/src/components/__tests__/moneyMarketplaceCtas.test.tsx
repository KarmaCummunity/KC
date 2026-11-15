// @vitest-environment jsdom
// Money, my-listing and About calls to action on the kit buttons (spec 17 §4.1.1, TD-243): each
// one routes or runs its use case as before and keeps its disabled rule.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';

const { router, payments, listings, external, linking } = vi.hoisted(() => ({
  router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
  payments: { getNonprofitPage: vi.fn(), donateNow: vi.fn() },
  listings: { getListingDetail: vi.fn(), updateMyListing: vi.fn() },
  external: { external: false, openExternal: vi.fn() },
  linking: { openURL: vi.fn(async () => true) },
}));

vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'he' } }) }));
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('expo-router', () => ({
  useRouter: () => router,
  useLocalSearchParams: () => ({ slug: 'kc', orgId: 'org_1', listingId: 'l_1' }),
}));
vi.mock('../ui/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../../navigation/useShellTabBarVisibility', () => ({
  useShellTabBarScrollInset: () => 0,
  useShellTabBarVisibility: () => false,
  shellTabBarHeightPx: () => 0,
}));
// The real helper pulls in the i18n bootstrap; only its behaviour matters here.
vi.mock('../../lib/backendAvailability', () => ({
  valueOrNull: (load: () => Promise<unknown>) => load(),
  runAction: async (action: () => Promise<unknown>) => ({ status: 'done', value: await action() }),
  notAvailableMessage: () => 'backend.notAvailableYet',
}));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return { ...actual, Linking: { openURL: linking.openURL } };
});
vi.mock('../../hooks/useExternalDonations', () => ({ useExternalDonations: () => external }));
vi.mock('../../lib/analytics', () => ({ track: vi.fn() }));
vi.mock('../../services/paymentsComposition', () => ({
  newIdempotencyKey: (kind: string) => `key-${kind}`,
  paymentsUseCases: Object.fromEntries(Object.entries(payments).map(([name, fn]) => [name, () => ({ execute: fn })])),
}));
vi.mock('../../services/marketplaceComposition', () => ({ marketplaceRepository: () => listings }));
vi.mock('../../hooks/useMyMarketplaceListings', () => ({ useInvalidateMyListings: () => () => Promise.resolve() }));
vi.mock('../../features/about-landing/aboutOpenExternalUrl', () => ({ aboutOpenExternalUrl: vi.fn() }));

import NonprofitScreen from '../../../app/(tabs)/donations/money/nonprofit/[slug]';
import DonateNowScreen from '../../../app/(tabs)/donations/money/donate/[orgId]';
import EditMyListingScreen from '../../../app/(tabs)/donations/marketplace/my-listings/edit/[listingId]';
import { AboutContactLinks } from '../../features/about-landing/AboutContactLinks';

const PAGE = { orgId: 'org_1', name: 'KC', aboutHe: null, aboutEn: null, taglineHe: null, taglineEn: null, totalRaisedAgorot: 0, campaigns: [] };

beforeEach(() => {
  vi.clearAllMocks();
  external.external = false;
  payments.getNonprofitPage.mockResolvedValue(PAGE);
  listings.getListingDetail.mockResolvedValue({ listingId: 'l_1', title: 'Sofa', summary: null });
});
afterEach(cleanup);

function renderScreen(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('nonprofit page', () => {
  it('opens the in-app donation and standing-order screens', async () => {
    const { findByRole, getByRole } = renderScreen(<NonprofitScreen />);
    fireEvent.click(await findByRole('button', { name: 'moneyPayments.donateNow' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/donations/money/donate/[orgId]', params: { orgId: 'org_1' } });
    fireEvent.click(getByRole('button', { name: 'moneyPayments.monthlyGift' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/donations/money/standing-order/[orgId]', params: { orgId: 'org_1' } });
  });

  it('hands both actions to the external provider when payments run outside the app', async () => {
    external.external = true;
    const { findByRole, getByRole } = renderScreen(<NonprofitScreen />);
    fireEvent.click(await findByRole('button', { name: 'moneyPayments.donateNow' }));
    fireEvent.click(getByRole('button', { name: 'moneyPayments.monthlyGift' }));
    expect(external.openExternal.mock.calls).toEqual([['donate', 'org_1'], ['standing-order', 'org_1']]);
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('donate screen', () => {
  it('starts the donation in agorot and sends the member to the checkout page', async () => {
    payments.donateNow.mockResolvedValue({ intentId: 'i_1', checkoutUrl: 'https://pay.example.test/i_1' });
    const { getByRole } = renderScreen(<DonateNowScreen />);
    fireEvent.click(getByRole('button', { name: 'moneyPayments.confirmDonate' }));
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(tabs)/donations/money/history'));
    expect(linking.openURL).toHaveBeenCalledWith('https://pay.example.test/i_1');
    expect(payments.donateNow).toHaveBeenCalledWith({ orgId: 'org_1', amountAgorot: 7200, idempotencyKey: 'key-donate', postId: 'l_1' });
  });

  it('says the donation is not available while the intent has no checkout page', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    payments.donateNow.mockResolvedValue({ intentId: 'i_1', checkoutUrl: null });
    const { getByRole } = renderScreen(<DonateNowScreen />);
    fireEvent.click(getByRole('button', { name: 'moneyPayments.confirmDonate' }));
    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('backend.notAvailableYet'));
    expect(router.replace).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});

describe('edit my listing', () => {
  it('needs a two-letter title, then saves and goes back, reading "saving" meanwhile', async () => {
    let settle: () => void = () => {};
    listings.updateMyListing.mockReturnValueOnce(new Promise<void>((resolve) => { settle = resolve; }));
    const { findByTestId, getByRole } = renderScreen(<EditMyListingScreen />);
    const save = await findByTestId('edit-listing-save');
    const title = getByRole('textbox', { name: 'marketplace.fieldTitle' });

    fireEvent.change(title, { target: { value: 'S' } });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(title, { target: { value: ' Sofa bed ' } });
    fireEvent.click(save);
    expect(listings.updateMyListing).toHaveBeenCalledWith('l_1', { title: 'Sofa bed', summary: null });
    await vi.waitFor(() => expect(save.textContent).toBe('marketplace.publishing'));
    await act(async () => settle());
    await vi.waitFor(() => expect(router.back).toHaveBeenCalled());
  });
});

describe('About contact links', () => {
  it('opens the report-issue form from the contact button', () => {
    const { getByRole } = renderScreen(<AboutContactLinks />);
    fireEvent.click(getByRole('button', { name: 'aboutContent.contactCta' }));
    expect(router.push).toHaveBeenCalledWith('/settings/report-issue');
  });
});
