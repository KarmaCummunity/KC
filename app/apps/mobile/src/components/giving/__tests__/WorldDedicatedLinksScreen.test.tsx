// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({
  useShellTabBarScrollInset: () => 64,
}));
vi.mock('../useWorldHeader', () => ({
  WorldSubScreenChrome: ({ activeScreenTestId }: { activeScreenTestId: string }) => (
    <div data-testid={`chrome-${activeScreenTestId}`} />
  ),
}));
vi.mock('../../DonationLinksList', () => ({
  DonationLinksList: ({ categorySlug }: { categorySlug: string }) => (
    <div data-testid={`donation-links-${categorySlug}`} />
  ),
}));
vi.mock('../../ui/Screen', () => ({
  Screen: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
}));

import { WorldDedicatedLinksScreen } from '../WorldDedicatedLinksScreen';

describe('WorldDedicatedLinksScreen (#1963)', () => {
  it('renders dedicated links sub-screen with WorldSubScreenChrome and DonationLinksList', () => {
    const { getByTestId, queryByTestId } = render(
      <WorldDedicatedLinksScreen worldSlug="animals" categorySlug="animals" />,
    );

    expect(getByTestId('chrome-world-hub-animals-links')).toBeTruthy();
    expect(getByTestId('world-links-screen-animals')).toBeTruthy();
    expect(getByTestId('donation-links-animals')).toBeTruthy();

    // No marketplace feed / post listings on this screen
    expect(queryByTestId('world-feed-list')).toBeNull();
    expect(queryByTestId('post-card-grid')).toBeNull();
  });

  it('renders for transport/rides world category correctly', () => {
    const { getByTestId } = render(
      <WorldDedicatedLinksScreen worldSlug="rides" categorySlug="transport" />,
    );

    expect(getByTestId('chrome-world-hub-rides-links')).toBeTruthy();
    expect(getByTestId('world-links-screen-rides')).toBeTruthy();
    expect(getByTestId('donation-links-transport')).toBeTruthy();
  });
});
