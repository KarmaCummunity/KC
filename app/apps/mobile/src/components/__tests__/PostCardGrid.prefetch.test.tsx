// @vitest-environment jsdom
// Tap-time warm-up of the feed card: pressing a listing-world card down starts loading the
// listing detail its screen blocks on, so the read overlaps the press and the navigation
// transition (FR-FEED-020). An ordinary items post has no listing detail to load.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { PostWithOwner } from '@kc/application';

const { getListingDetail } = vi.hoisted(() => ({ getListingDetail: vi.fn(() => Promise.resolve(null)) }));
vi.mock('../../services/marketplaceComposition', () => ({ marketplaceRepository: () => ({ getListingDetail }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('expo-image', () => ({ Image: { prefetch: vi.fn(() => Promise.resolve()) } }));
vi.mock('../../lib/imageUrl', () => ({ getSupabasePublicImageUrl: () => null, getSupabaseFeedImageUrl: () => null }));
vi.mock('../post/PostMenuButton', () => ({ PostMenuButton: () => null }));
vi.mock('../post/PostCardActorsRow', () => ({ PostCardActorsRow: () => null }));
// The card shell is reduced to its press-down surface; its rendering has its own tests.
vi.mock('../cards/KcCard', () => ({
  KcCard: ({ onPressIn }: { onPressIn?: () => void }) => (
    <button type="button" data-testid="card" onMouseDown={onPressIn} />
  ),
}));

import { PostCardGrid } from '../PostCardGrid';

afterEach(() => {
  cleanup();
  getListingDetail.mockClear();
});

const ITEMS_POST = {
  postId: 'p_1',
  ownerId: 'u_owner',
  type: 'Give',
  status: 'open',
  title: 'Bookshelf',
  category: 'Books',
  address: { city: 'tel-aviv', cityName: 'Tel Aviv', street: '', streetNumber: '' },
  createdAt: '2026-11-01T08:00:00.000Z',
  mediaAssets: [],
  listingId: null,
  listingWorldSlug: null,
} as unknown as PostWithOwner;

function pressCardDown(post: PostWithOwner) {
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <PostCardGrid post={post} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  fireEvent.mouseDown(view.getByTestId('card'));
}

describe('PostCardGrid — press-down warm-up', () => {
  it('starts loading the listing detail of a listing-world card', () => {
    pressCardDown({ ...ITEMS_POST, listingId: 'l_ride', listingWorldSlug: 'rides' });
    expect(getListingDetail).toHaveBeenCalledWith('l_ride');
  });

  it('loads no listing detail for an ordinary items post', () => {
    pressCardDown(ITEMS_POST);
    expect(getListingDetail).not.toHaveBeenCalled();
  });
});
