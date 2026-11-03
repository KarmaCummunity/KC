// @vitest-environment jsdom
// FR-FEED-020 AC1 — a feed card of a rides / housing / time / food listing mirror shows its
// giving world (chip + placeholder icon) instead of the legacy "Other" category; an ordinary
// post keeps its item subcategory.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { PostWithOwner } from '@kc/application';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
// Native image modules: the card has no photo here, so only the placeholder icon renders.
vi.mock('../ui/KCImage', () => ({ KCImage: () => null }));
vi.mock('../AvatarInitials', () => ({ AvatarInitials: () => null }));
vi.mock('../../lib/imageUrl', () => ({ getSupabasePublicImageUrl: () => null, getSupabaseFeedImageUrl: () => null }));
// The overflow menu has its own tests (PostMenuSheet.test.tsx).
vi.mock('../post/PostMenuButton', () => ({ PostMenuButton: () => null }));

import { PostCardGrid } from '../PostCardGrid';

afterEach(cleanup);

const BASE: PostWithOwner = {
  postId: 'p_1',
  ownerId: 'u_owner',
  type: 'Give',
  status: 'open',
  statusBeforeAdminRemoval: null,
  visibility: 'Public',
  title: 'Tel Aviv to Jerusalem',
  description: null,
  category: 'Other',
  address: { city: 'tel-aviv', cityName: 'Tel Aviv', street: 'Marketplace', streetNumber: '1' },
  locationDisplayLevel: 'CityOnly',
  itemCondition: null,
  urgency: null,
  estimatedValue: null,
  sourceLanguage: null,
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z',
  mediaAssets: [],
  recipient: null,
  reopenCount: 0,
  deleteAfter: null,
  listingId: null,
  listingWorldSlug: null,
  ownerName: 'Dana',
  ownerAvatarUrl: null,
  ownerHandle: 'dana',
  ownerPrivacyMode: 'Public',
  recipientUser: null,
  distanceKm: null,
};

function renderCard(post: PostWithOwner) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <PostCardGrid post={post} />
    </ThemeProvider>,
  );
}

describe('PostCardGrid — giving world of a listing mirror', () => {
  it('shows the rides world chip and car icon on a ride listing mirror', () => {
    const view = renderCard({ ...BASE, listingId: 'l_ride', listingWorldSlug: 'rides' });
    expect(view.getByText('post.unifiedCreate.categories.rides')).toBeTruthy();
    expect(view.getByTestId('icon-car-outline')).toBeTruthy();
    expect(view.queryByText('post.category.Other')).toBeNull();
  });

  it('shows the housing world on a request mirror, not the request icon', () => {
    const view = renderCard({ ...BASE, type: 'Request', listingId: 'l_stay', listingWorldSlug: 'housing' });
    expect(view.getByText('post.unifiedCreate.categories.housing')).toBeTruthy();
    expect(view.getByTestId('icon-home-outline')).toBeTruthy();
    expect(view.queryByTestId('icon-hand-left-outline')).toBeNull();
  });

  it('keeps the item subcategory on an ordinary post', () => {
    const view = renderCard({ ...BASE, title: 'Bookshelf', category: 'Books' });
    expect(view.getByText('post.category.Books')).toBeTruthy();
    expect(view.getByTestId('icon-book-outline')).toBeTruthy();
  });
});
