// @vitest-environment jsdom
// FR-CHAT-014 / KC#1297 — the chat header shows the listing the chat was opened from, opens it
// on tap, and shows nothing when the viewer can no longer see the listing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { MarketplaceListingDetail } from '@kc/domain';

const push = vi.fn();
const getListingDetail = vi.fn();

vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../ui/KCImage', () => ({ KCImage: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../../services/marketplaceComposition', () => ({
  marketplaceRepository: () => ({ getListingDetail }),
}));
vi.mock('../../../services/listingImageUpload', () => ({
  listingImagePublicUrl: (path: string) => `https://cdn.test/${path}`,
}));

import { AnchoredListingCard } from '../AnchoredListingCard';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LISTING: MarketplaceListingDetail = {
  listingId: 'l_1',
  ownerId: 'u_giver',
  worldSlug: 'items',
  worldLabelEn: 'Items',
  worldLabelHe: 'חפצים',
  kindSlug: 'give_item',
  kindLabelEn: 'Give an item',
  kindLabelHe: 'מסירת חפץ',
  direction: 'give',
  title: 'Bookshelf',
  summary: null,
  details: {},
  cityId: null,
  urgencyLevel: 2,
  availabilityStatus: 'immediate',
  publishedAt: null,
  lat: null,
  lng: null,
  maxRadiusKm: null,
  media: [],
  owner: null,
  feedPostId: null,
  feedHidden: false,
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <AnchoredListingCard anchorListingId="l_1" />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('AnchoredListingCard', () => {
  it('shows the anchored listing and opens it on tap', async () => {
    getListingDetail.mockResolvedValue(LISTING);
    const { findByTestId, getByText } = renderCard();

    const card = await findByTestId('chat-anchored-listing');
    expect(getByText('Bookshelf')).toBeTruthy();
    expect(getByText('marketplace.world.items · מסירת חפץ')).toBeTruthy();
    expect(getListingDetail).toHaveBeenCalledWith('l_1');

    fireEvent.click(card);
    expect(push).toHaveBeenCalledWith('/listing/l_1');
  });

  it('renders nothing when the listing is no longer visible to the viewer', async () => {
    getListingDetail.mockResolvedValue(null);
    const { queryByTestId } = renderCard();

    await vi.waitFor(() => expect(getListingDetail).toHaveBeenCalled());
    expect(queryByTestId('chat-anchored-listing')).toBeNull();
  });
});
