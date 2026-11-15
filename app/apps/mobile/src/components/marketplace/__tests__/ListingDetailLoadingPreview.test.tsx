// @vitest-environment jsdom
// FR-FEED-020 / NFR-PERF-005 — a listing-world post opens with the content its feed card already
// carries (title, world chip, description, photo) while the listing detail is still loading.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { PostWithOwner } from '@kc/application';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../ui/KCImage', () => ({
  KCImage: ({ uri }: { uri: string }) => <span data-testid="hero-image" data-uri={uri} />,
}));
vi.mock('../../../lib/imageUrl', () => ({
  getSupabasePublicImageUrl: ({ bucket, path }: { bucket: string; path: string }) => `https://cdn.test/${bucket}/${path}`,
}));

import { ListingDetailLoadingPreview } from '../ListingDetailLoadingPreview';

afterEach(cleanup);

const RIDE = {
  postId: 'p_ride',
  type: 'Give',
  title: 'Tel Aviv to Jerusalem',
  description: 'Leaving at eight, two free seats',
  category: 'Other',
  mediaAssets: [],
  listingId: 'p_ride',
  listingWorldSlug: 'rides',
} as unknown as PostWithOwner;

function renderPreview(post: PostWithOwner) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <ListingDetailLoadingPreview post={post} />
    </ThemeProvider>,
  );
}

describe('ListingDetailLoadingPreview', () => {
  it('shows the title, world chip and description of the post, with the world icon when it has no photo', () => {
    const view = renderPreview(RIDE);
    expect(view.getByText('Tel Aviv to Jerusalem')).toBeTruthy();
    expect(view.getByText('Leaving at eight, two free seats')).toBeTruthy();
    expect(view.getByText('post.unifiedCreate.categories.rides')).toBeTruthy();
    expect(view.getByText('feed.giveTypeShort')).toBeTruthy();
    expect(view.getByTestId('icon-car-outline')).toBeTruthy();
  });

  it('shows the cover photo from its own bucket and the request tag of a request', () => {
    const view = renderPreview({
      ...RIDE,
      type: 'Request',
      mediaAssets: [{ bucket: 'listing-images', path: 'l1/cover.jpg' }],
    } as unknown as PostWithOwner);
    expect(view.getByTestId('hero-image').getAttribute('data-uri')).toBe('https://cdn.test/listing-images/l1/cover.jpg');
    expect(view.getByText('feed.requestTypeShort')).toBeTruthy();
    expect(view.queryByTestId('icon-car-outline')).toBeNull();
  });
});
