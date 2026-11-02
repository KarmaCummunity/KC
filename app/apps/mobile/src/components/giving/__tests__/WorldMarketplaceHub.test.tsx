// @vitest-environment jsdom
// FR-FEED-020 AC2 — a giving world's screen: "request" / "offer" open the create form preset
// to the world and direction; its feed lists offers and requests, narrows by direction, and
// searches within the world; sub-screen links open the world's own screens; an empty,
// filtered feed offers to clear the filters.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { MarketplaceBrowseRow } from '@kc/domain';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  browsePage: vi.fn(),
  searchPage: vi.fn(),
  getListingCards: vi.fn(),
  listWorldSubcategories: vi.fn(),
}));

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }),
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarScrollInset: () => 0 }));
vi.mock('../../../services/marketplaceComposition', () => ({
  marketplaceRepository: () => ({
    browsePage: mocks.browsePage,
    searchPage: mocks.searchPage,
    getListingCards: mocks.getListingCards,
    listWorldSubcategories: mocks.listWorldSubcategories,
  }),
}));
// Surfaces with their own tests and their own I/O.
vi.mock('../../ui/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../DonationLinksList', () => ({ DonationLinksList: () => null }));
vi.mock('../../cards/ListingCard', () => ({
  ListingCard: ({ item }: { item: MarketplaceBrowseRow }) => <div data-testid={`card-${item.listingId}`}>{item.title}</div>,
}));

import { WorldMarketplaceHub } from '../WorldMarketplaceHub';
import { worldSubScreens } from '../worldSubScreens';

const card = (listingId: string, direction: 'give' | 'request') =>
  ({ listingId, direction, title: listingId, worldSlug: 'food' }) as unknown as MarketplaceBrowseRow;

beforeEach(() => {
  mocks.browsePage.mockResolvedValue({ rows: [card('offer-1', 'give'), card('request-1', 'request')], nextCursor: null });
  mocks.searchPage.mockResolvedValue({ rows: ['s-offer', 's-request'], nextCursor: null });
  mocks.getListingCards.mockResolvedValue([card('s-offer', 'give'), card('s-request', 'request')]);
  mocks.listWorldSubcategories.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function renderHub(worldSlug: 'food' | 'knowledge' = 'food') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <WorldMarketplaceHub
          worldSlug={worldSlug}
          icon="restaurant-outline"
          introKey="givingHandoff.foodHubIntro"
          subScreens={worldSubScreens('/(tabs)/donations/food/handoffs')}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const lastBrowseFilters = () => mocks.browsePage.mock.calls.at(-1)?.[0];

describe('WorldMarketplaceHub — the world feed', () => {
  it('opens the create form preset to the world and direction', () => {
    renderHub();
    fireEvent.click(screen.getByTestId('world-hub-request'));
    expect(mocks.push).toHaveBeenLastCalledWith('/(tabs)/create?category=food&direction=request');
    fireEvent.click(screen.getByTestId('world-hub-offer'));
    expect(mocks.push).toHaveBeenLastCalledWith('/(tabs)/create?category=food&direction=give');
  });

  it('shows no request / offer buttons for a world the create form does not offer', () => {
    renderHub('knowledge');
    expect(screen.queryByTestId('world-hub-request')).toBeNull();
    expect(screen.queryByTestId('world-hub-offer')).toBeNull();
  });

  it('links the world sub-screens', () => {
    renderHub();
    fireEvent.click(screen.getByTestId('world-hub-my-handoffs'));
    expect(mocks.push).toHaveBeenLastCalledWith('/(tabs)/donations/food/handoffs');
    fireEvent.click(screen.getByTestId('world-hub-my-listings'));
    expect(mocks.push).toHaveBeenLastCalledWith('/(tabs)/donations/marketplace/my-listings');
  });

  it('lists offers and requests of the world, then narrows to one direction', async () => {
    renderHub();
    expect(await screen.findByTestId('card-offer-1')).toBeTruthy();
    expect(screen.getByTestId('card-request-1')).toBeTruthy();
    expect(lastBrowseFilters()).toMatchObject({ worldSlug: 'food', direction: null, categoryId: null, radiusKm: 25 });
    expect(screen.getByTestId('world-feed-direction-all').getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getAllByRole('checkbox').map((c) => c.getAttribute('data-testid')).filter((id) => id?.startsWith('world-feed-direction-')),
    ).toEqual(['world-feed-direction-all', 'world-feed-direction-give', 'world-feed-direction-request']);

    fireEvent.click(screen.getByTestId('world-feed-direction-request'));
    await waitFor(() => expect(lastBrowseFilters()).toMatchObject({ worldSlug: 'food', direction: 'request' }));
    expect(screen.getByTestId('world-feed-direction-request').getAttribute('aria-checked')).toBe('true');
  });

  it('searches within the world and applies the direction to the results', async () => {
    renderHub();
    const input = screen.getByTestId('world-feed-search');
    fireEvent.change(input, { target: { value: 'חלה' } });
    expect(await screen.findByTestId('card-s-request')).toBeTruthy();
    expect(mocks.searchPage).toHaveBeenCalledWith('חלה', 'food', expect.any(Number), null);
    // The refine chips apply to browsing only; a text search spans the whole world.
    expect(screen.queryByTestId('browse-refine-radius-25')).toBeNull();

    fireEvent.click(screen.getByTestId('world-feed-direction-give'));
    await waitFor(() => expect(screen.queryByTestId('card-s-request')).toBeNull());
    expect(screen.getByTestId('card-s-offer')).toBeTruthy();
  });

  it('does not search for a one-letter query', async () => {
    renderHub();
    await screen.findByTestId('card-offer-1');
    await act(async () => {
      fireEvent.change(screen.getByTestId('world-feed-search'), { target: { value: 'ח' } });
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(mocks.searchPage).not.toHaveBeenCalled();
    expect(screen.getByTestId('card-offer-1')).toBeTruthy();
  });

  it('offers to clear the filters of an empty feed, and clearing restores the whole world', async () => {
    mocks.browsePage.mockImplementation(async (filters: { direction: string | null }) => ({
      rows: filters.direction === 'request' ? [] : [card('offer-1', 'give')],
      nextCursor: null,
    }));
    renderHub();
    await screen.findByTestId('card-offer-1');

    fireEvent.click(screen.getByTestId('world-feed-direction-request'));
    fireEvent.click(await screen.findByTestId('world-feed-empty-clear'));
    // The whole-world page is served again (from the query cache) and "all" is selected.
    expect(await screen.findByTestId('card-offer-1')).toBeTruthy();
    expect(screen.getByTestId('world-feed-direction-all').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('world-feed-direction-request').getAttribute('aria-checked')).toBe('false');
  });

  it('an empty, unfiltered world invites the first listing without a clear action', async () => {
    mocks.browsePage.mockResolvedValue({ rows: [], nextCursor: null });
    renderHub();
    fireEvent.click(await screen.findByTestId('world-feed-empty-create'));
    expect(mocks.push).toHaveBeenLastCalledWith('/(tabs)/create?category=food');
    expect(screen.queryByTestId('world-feed-empty-clear')).toBeNull();
  });
});
