// @vitest-environment jsdom
// G44 / D70 — an old link to a retired legacy ride opens the ride's listing, or the rides hub.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

const { replace, params } = vi.hoisted(() => ({
  replace: vi.fn(),
  params: { id: undefined as string | undefined },
}));

vi.mock('expo-router', () => ({ useRouter: () => ({ replace }), useLocalSearchParams: () => params }));

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
  it('opens the listing of a well-formed ride id', () => {
    params.id = '11111111-1111-4111-8111-111111111111';
    renderRedirect();
    expect(replace).toHaveBeenCalledWith({
      pathname: '/(tabs)/donations/marketplace/[listingId]',
      params: { listingId: params.id },
    });
  });

  it('falls back to the rides hub for an id that cannot be a ride', () => {
    params.id = 'r1';
    renderRedirect();
    expect(replace).toHaveBeenCalledWith('/(tabs)/donations/rides');
  });
});
