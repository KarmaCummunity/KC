// @vitest-environment jsdom
// The listing detail screen while its read is on the wire: the host's preview when one is given
// (the post detail passes the feed card's content), the plain spinner otherwise.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';

const query = vi.hoisted(() => ({ value: { data: undefined as unknown, isLoading: true, isError: false, refetch: vi.fn() } }));
vi.mock('../../../hooks/useMarketplaceListingDetail', () => ({ useMarketplaceListingDetail: () => query.value }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../components/ui/Screen', () => ({
  Screen: ({ children, testID }: { children: React.ReactNode; testID?: string }) => <div data-testid={testID ?? 'screen'}>{children}</div>,
}));
vi.mock('../../../components/EmptyState', () => ({ EmptyState: () => <span data-testid="error-state" /> }));
vi.mock('../../../components/ui/Buttons', () => ({ PrimaryButton: () => null }));
vi.mock('../../../components/marketplace/MarketplaceListingDetailView', () => ({
  MarketplaceListingDetailView: () => <span data-testid="detail-view" />,
}));

import { MarketplaceListingDetailScreen } from '../MarketplaceListingDetailScreen';

afterEach(() => {
  cleanup();
  query.value = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
});

describe('MarketplaceListingDetailScreen', () => {
  it('shows the host preview instead of a blank spinner while the detail loads', () => {
    const view = render(
      <MarketplaceListingDetailScreen listingId="l1" loadingPreview={<span data-testid="preview" />} />,
    );
    expect(view.getByTestId('preview')).toBeTruthy();
    expect(view.queryByRole('progressbar')).toBeNull();
    expect(view.queryByTestId('detail-view')).toBeNull();
  });

  it('falls back to the spinner when the host gives no preview', () => {
    const view = render(<MarketplaceListingDetailScreen listingId="l1" />);
    expect(view.getByRole('progressbar')).toBeTruthy();
  });

  it('replaces the preview with the detail once it has loaded', () => {
    query.value = { data: { listingId: 'l1' }, isLoading: false, isError: false, refetch: vi.fn() };
    const view = render(
      <MarketplaceListingDetailScreen listingId="l1" loadingPreview={<span data-testid="preview" />} />,
    );
    expect(view.getByTestId('detail-view')).toBeTruthy();
    expect(view.queryByTestId('preview')).toBeNull();
  });
});
