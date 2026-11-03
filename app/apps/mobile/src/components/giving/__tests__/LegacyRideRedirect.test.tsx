// @vitest-environment jsdom
// G44 / D70 — an old link to a retired legacy ride opens its listing, or the rides hub.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

const { replace, findListingForLegacyRide, params } = vi.hoisted(() => ({
  replace: vi.fn(),
  findListingForLegacyRide: vi.fn(),
  params: { id: 'r1' as string | undefined },
}));

vi.mock('expo-router', () => ({ useRouter: () => ({ replace }), useLocalSearchParams: () => params }));
vi.mock('../../../services/rideLegacyLinkComposition', () => ({ findListingForLegacyRide }));

import { LegacyRideRedirect } from '../LegacyRideRedirect';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderRedirect = () =>
  render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <LegacyRideRedirect />
    </ThemeProvider>,
  );

describe('LegacyRideRedirect', () => {
  it('opens the listing the legacy ride became', async () => {
    findListingForLegacyRide.mockResolvedValue('l9');
    renderRedirect();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/(tabs)/donations/marketplace/[listingId]', params: { listingId: 'l9' } }),
    );
    expect(findListingForLegacyRide).toHaveBeenCalledWith('r1');
  });

  it('falls back to the rides hub when there is no listing or the lookup fails', async () => {
    findListingForLegacyRide.mockResolvedValueOnce(null);
    renderRedirect();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/(tabs)/donations/rides'));

    cleanup();
    replace.mockClear();
    findListingForLegacyRide.mockRejectedValueOnce(new Error('offline'));
    renderRedirect();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/(tabs)/donations/rides'));
  });
});
