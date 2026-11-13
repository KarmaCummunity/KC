// @vitest-environment jsdom
// FR-POST-003 / FR-POST-009 — every listing form ends with the same exposure settings block, and
// the member's choices reach the published listing (a time offer here, a ride for the no-address case).
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import { KINDS_BY_WORLD } from '../../../lib/unifiedCreate/__tests__/listingKindFixtures';
import { exposureSpies } from '../../../lib/unifiedCreate/__tests__/listingExposureDoubles';

const mocks = vi.hoisted(() => ({ listKindsForWorld: vi.fn(), createListing: vi.fn() }));
const RIDE_FILL = vi.hoisted(() => ({
  origin_label: 'לוד', dest_label: 'תל אביב', origin_lat: 31.95, origin_lng: 34.89, origin_city_id: '7000',
  dest_lat: 32.08, dest_lng: 34.78, dest_city_id: '5000', departs_at: '2030-01-01T08:30:00.000Z',
}));

vi.mock('../../../services/postsComposition', async () => (await import('../../../lib/unifiedCreate/__tests__/listingExposureDoubles')).postsCompositionDouble);
vi.mock('../../../services/userComposition', async () => (await import('../../../lib/unifiedCreate/__tests__/listingExposureDoubles')).userCompositionDouble);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@react-native-community/datetimepicker', () => ({ default: () => null, DateTimePickerAndroid: { open: vi.fn() } }));
vi.mock('../../../services/marketplaceComposition', () => ({
  marketplaceRepository: () => ({ listKindsForWorld: mocks.listKindsForWorld, createListing: mocks.createListing, listWorldSubcategories: async () => [] }),
}));
vi.mock('../../../services/listingImageUpload', () => ({ pickListingImages: vi.fn(async () => []), uploadListingImages: vi.fn() }));
vi.mock('../../../services/rideSeriesComposition', () => ({ rideSeriesUseCases: { create: () => ({ execute: vi.fn() }) } }));
vi.mock('../../../lib/rides/rideStartDetails', () => ({ rememberRideRoute: vi.fn() }));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: vi.fn(), trackActivationIfFirst: vi.fn() }));
vi.mock('../../../lib/haptics', () => ({ hapticLightImpact: () => undefined, hapticLightTap: () => {} }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarScrollInset: () => 0 }));
vi.mock('../../../store/authStore', () => {
  const state = { session: { userId: 'u1', accountCreatedAt: '2026-01-01T00:00:00.000Z' } };
  const useAuthStore = (sel: (s: typeof state) => unknown) => sel(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});
vi.mock('../../CityPicker', () => ({
  CityPicker: ({ onChange }: { onChange: (c: { id: string; name: string }) => void }) => (
    <button type="button" data-testid="city-picker" onClick={() => onChange({ id: '7000', name: 'לוד' })} />
  ),
}));
// Ride section stand-in: one tap fills a route; another makes the ride recur.
vi.mock('../../giving/RideCreateSection', () => ({
  RIDE_CREATE_DETAIL_KEYS: [],
  RideCreateSection: (p: {
    setDetails: (u: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
    onOriginCity: (c: { id: string; name: string }) => void;
    onRecurrenceChange: (next: { weekdays: number[]; endsOn: Date | null } | null) => void;
  }) => (
    <>
      <button type="button" data-testid="ride-section-fill" onClick={() => { p.setDetails((prev) => ({ ...prev, ...RIDE_FILL })); p.onOriginCity({ id: '7000', name: 'לוד' }); }} />
      <button type="button" data-testid="ride-section-recur" onClick={() => p.onRecurrenceChange({ weekdays: [0, 4], endsOn: null })} />
    </>
  ),
}));

import { ListingCreateForm } from '../ListingCreateForm';

function renderForm(worldSlug: string) {
  const onPublished = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <ListingCreateForm
          worldSlug={worldSlug} header={null} direction="give" title="כותרת" onTitleChange={() => {}}
          summary="" onSummaryChange={() => {}} onPublished={onPublished} onPublishActionChange={() => {}}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onPublished };
}

const EXPOSURE_TOGGLE = { name: 'post.exposureSettingsSectionTitle' };

beforeEach(() => {
  mocks.listKindsForWorld.mockImplementation(async (world: string) => KINDS_BY_WORLD[world] ?? []);
  mocks.createListing.mockResolvedValue('listing-1');
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ListingCreateForm — exposure settings', () => {
  it('ends with the exposure settings, closed, and publishes with the default audience and address level', async () => {
    const { onPublished } = renderForm('time');
    const toggle = await screen.findByRole('button', EXPOSURE_TOGGLE);
    expect(toggle.getAttribute('aria-expanded')).not.toBe('true');
    expect(screen.queryByText('post.locationDisplayLabel')).toBeNull();
    fireEvent.click(toggle);
    // Opened: an address-bearing listing offers the address level (a ride does not, below).
    expect(await screen.findByText('post.locationDisplayLabel')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('city-picker'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('listing-publish'));
    });
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith('listing-1'));
    expect(mocks.createListing).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'Public', locationDisplayLevel: 'CityAndStreet' }));
    // Nothing differs from a fresh post, so the identity row is left alone.
    expect(exposureSpies.upsertIdentity).not.toHaveBeenCalled();
  });

  it('writes the identity mask after publishing when the member hides who published it', async () => {
    const { onPublished } = renderForm('time');
    fireEvent.click(await screen.findByRole('button', EXPOSURE_TOGGLE));
    fireEvent.click(await screen.findByRole('switch'));
    fireEvent.click(await screen.findByTestId('city-picker'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('listing-publish'));
    });
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith('listing-1'));
    expect(exposureSpies.upsertIdentity).toHaveBeenCalledWith(expect.objectContaining({ postId: 'listing-1', hideFromCounterparty: true }));
  });

  it('a ride offers the audience but no address level, and sends none', async () => {
    renderForm('rides');
    fireEvent.click(await screen.findByRole('button', EXPOSURE_TOGGLE));
    expect(screen.queryByText('post.locationDisplayLabel')).toBeNull();
    fireEvent.click(await screen.findByTestId('ride-section-fill'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('listing-publish'));
    });
    await waitFor(() => expect(mocks.createListing).toHaveBeenCalled());
    const payload = mocks.createListing.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({ visibility: 'Public' });
    expect(payload).not.toHaveProperty('locationDisplayLevel');
  });

  it('offers no exposure settings while the ride recurs: the series is published with the usual defaults', async () => {
    renderForm('rides');
    expect(await screen.findByRole('button', EXPOSURE_TOGGLE)).toBeTruthy();
    fireEvent.click(await screen.findByTestId('ride-section-recur'));
    await waitFor(() => expect(screen.queryByRole('button', EXPOSURE_TOGGLE)).toBeNull());
  });
});
