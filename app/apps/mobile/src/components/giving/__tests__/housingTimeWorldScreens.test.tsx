// @vitest-environment jsdom
// FR-FEED-020 AC2 / AC3 — the housing and time world screens: with the world's launch flag on
// they render the world feed (request / offer, search, feed) with the world's sub-screens;
// with it off they stay a portal (D60) and show no feed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import type { WorldMarketplaceHubProps } from '../WorldMarketplaceHub';

const mocks = vi.hoisted(() => ({ enabled: true, hubProps: [] as WorldMarketplaceHubProps[] }));

vi.mock('../../../hooks/useLaunchWorldFlags', () => ({
  useLaunchWorldEnabled: () => mocks.enabled,
  useMarketplaceWorldLaunchEnabled: () => mocks.enabled,
}));
vi.mock('../../worlds/WorldPortalScreen', () => ({
  WorldPortalScreen: ({ categorySlug }: { categorySlug?: string }) => <div data-testid={`portal-${categorySlug}`} />,
}));
vi.mock('../WorldMarketplaceHub', () => ({
  WorldMarketplaceHub: (props: WorldMarketplaceHubProps) => {
    mocks.hubProps.push(props);
    return <div data-testid={`world-feed-${props.worldSlug}`} />;
  },
}));
vi.mock('../time/TimeOpportunitiesSection', () => ({ TimeOpportunitiesSection: () => null }));
// The route files export the shared RouteErrorBoundary (KC#1410), whose expo-router
// import is untransformed TSX under vitest; the screens themselves never navigate here.
vi.mock('expo-router', () => ({ usePathname: () => '/' }));
// The empty-state actions are kit buttons, which pull in reanimated and haptics (CTAs 3).
vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

import HousingWorldScreen from '../../../../app/(tabs)/donations/housing/index';
import TimeWorldScreen from '../../../../app/(tabs)/donations/time/index';

afterEach(() => {
  cleanup();
  mocks.hubProps = [];
  mocks.enabled = true;
});

const subScreenPaths = () => (mocks.hubProps.at(-1)?.subScreens ?? []).map((s) => s.path);

describe('housing and time world screens', () => {
  it('housing: an active world shows its feed with handoffs and listings', () => {
    render(<HousingWorldScreen />);
    expect(screen.getByTestId('world-feed-housing')).toBeTruthy();
    expect(mocks.hubProps.at(-1)).toMatchObject({ worldSlug: 'housing', icon: 'home-outline' });
    expect(subScreenPaths()).toEqual([
      '/(tabs)/donations/housing/handoffs',
      '/(tabs)/donations/marketplace/my-listings',
      '/(tabs)/donations/housing/hosting',
      '/(tabs)/donations/housing/stays',
      '/(tabs)/donations/housing/links',
    ]);
  });

  it('time: an active world shows its feed, the organisations section and its own screens', () => {
    render(<TimeWorldScreen />);
    expect(screen.getByTestId('world-feed-time')).toBeTruthy();
    expect(mocks.hubProps.at(-1)).toMatchObject({ worldSlug: 'time', icon: 'time-outline' });
    expect(mocks.hubProps.at(-1)?.headerExtra).toBeTruthy();
    expect(subScreenPaths()).toEqual([
      '/(tabs)/donations/time/handoffs',
      '/(tabs)/donations/marketplace/my-listings',
      '/(tabs)/donations/time/my-shifts',
      '/(tabs)/donations/time/organizer',
      '/(tabs)/donations/time/series',
      '/(tabs)/donations/time/support',
      '/(tabs)/donations/time/links',
    ]);
  });

  it.each([
    ['housing', HousingWorldScreen],
    ['time', TimeWorldScreen],
  ] as const)('%s: a world whose launch flag is off stays a portal without a feed', (slug, Screen) => {
    mocks.enabled = false;
    render(<Screen />);
    expect(screen.getByTestId(`portal-${slug}`)).toBeTruthy();
    expect(screen.queryByTestId(`world-feed-${slug}`)).toBeNull();
  });
});
