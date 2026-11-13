// @vitest-environment jsdom
// FR-POST-001 AC6 — the listing create form (rides / food / housing / time). Regression for
// the TestFlight create-form crash: every category renders in both directions and survives a
// direction switch; the form never mounts an inline native date picker or slider; required
// fields block publish with a message; a valid form publishes the expected listing.
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import { KINDS_BY_WORLD } from '../../../lib/unifiedCreate/__tests__/listingKindFixtures';

// vi.mock factories are hoisted above imports, so their spies must be hoisted too.
const mocks = vi.hoisted(() => ({
  listKindsForWorld: vi.fn(),
  createListing: vi.fn(),
  createRideSeries: vi.fn(),
  rememberRideRoute: vi.fn(),
  nativeDatePicker: vi.fn(() => null),
}));

vi.mock('../../../services/postsComposition', async () => (await import('../../../lib/unifiedCreate/__tests__/listingExposureDoubles')).postsCompositionDouble);
vi.mock('../../../services/userComposition', async () => (await import('../../../lib/unifiedCreate/__tests__/listingExposureDoubles')).userCompositionDouble);
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.field ? `${k}:${String(o.field)}` : k),
    i18n: { language: 'he' },
  }),
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) })); // the membership hint (FR-ORG-002)
// A native picker may only ever mount inside the date sheet, never inline in the form.
vi.mock('@react-native-community/datetimepicker', () => ({
  default: mocks.nativeDatePicker,
  DateTimePickerAndroid: { open: vi.fn() },
}));
vi.mock('../../../services/marketplaceComposition', () => ({
  marketplaceRepository: () => ({
    listKindsForWorld: mocks.listKindsForWorld,
    createListing: mocks.createListing,
    listWorldSubcategories: async () => [],
  }),
}));
vi.mock('../../../lib/rides/rideStartDetails', () => ({ rememberRideRoute: mocks.rememberRideRoute }));
vi.mock('../../../services/rideSeriesComposition', () => ({
  rideSeriesUseCases: { create: () => ({ execute: mocks.createRideSeries }) },
}));
// Ride section stand-in (route + schedule are tested in RideRouteFields / RideScheduleFields):
// one tap fills a full route and departure through the form's state setter; another makes the
// ride recur on Sundays and Thursdays (FR-RIDE-046).
// The origin and recurrence controls sit in the real field frames, as in RideCreateSection.
vi.mock('../../giving/RideCreateSection', async () => {
  const { ListingFieldFrame } = await vi.importActual<typeof import('../ListingFieldFrame')>('../ListingFieldFrame');
  return {
    RIDE_CREATE_DETAIL_KEYS: ['origin_lat', 'origin_lng', 'dest_lat', 'dest_lng', 'origin_city_id', 'dest_city_id', 'departs_at', 'arrives_at', 'seats_available'],
    RideCreateSection: (p: {
      setDetails: (u: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
      onOriginCity: (c: { id: string; name: string }) => void;
      onRecurrenceChange: (next: { weekdays: number[]; endsOn: Date | null } | null) => void;
    }) => (
      <>
        <ListingFieldFrame field="ride:origin" testID="ride-origin-frame">
          <button type="button" data-testid="ride-section-fill" onClick={() => {
            p.setDetails((prev) => ({ ...prev, ...RIDE_FILL }));
            p.onOriginCity({ id: '7000', name: 'לוד' });
          }}>
            <span data-testid="ride-section" />
          </button>
        </ListingFieldFrame>
        <ListingFieldFrame field="ride:recurrence" testID="ride-recurrence-frame">
          <button type="button" data-testid="ride-section-recur" onClick={() => p.onRecurrenceChange({ weekdays: [0, 4], endsOn: null })} />
          <button type="button" data-testid="ride-section-recur-nodays" onClick={() => p.onRecurrenceChange({ weekdays: [], endsOn: null })} />
        </ListingFieldFrame>
      </>
    ),
  };
});
vi.mock('../../../services/listingImageUpload', () => ({ pickListingImages: vi.fn(async () => []), uploadListingImages: vi.fn() }));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: vi.fn(), trackActivationIfFirst: vi.fn() }));
vi.mock('../../../lib/haptics', () => ({ hapticLightImpact: () => undefined, hapticLightTap: () => {} }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarScrollInset: () => 0 }));
vi.mock('../../../store/authStore', () => {
  const state = { session: { userId: 'u1', accountCreatedAt: '2026-01-01T00:00:00.000Z' } };
  const useAuthStore = (sel: (s: typeof state) => unknown) => sel(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});
// City picker stand-in: one tap picks Lod.
vi.mock('../../CityPicker', () => ({
  CityPicker: ({ onChange }: { onChange: (c: { id: string; name: string }) => void }) => (
    <button type="button" data-testid="city-picker" onClick={() => onChange({ id: '7000', name: 'לוד' })} />
  ),
}));
import { ListingCreateForm } from '../ListingCreateForm';
const RIDE_FILL = vi.hoisted(() => ({
  origin_label: 'לוד',
  dest_label: 'תל אביב',
  origin_lat: 31.95,
  origin_lng: 34.89,
  origin_city_id: '7000',
  dest_lat: 32.08,
  dest_lng: 34.78,
  dest_city_id: '5000',
  departs_at: '2030-01-01T08:30:00.000Z',
}));

function renderForm(worldSlug: string, direction: 'give' | 'request', title = 'כותרת') {
  const onPublished = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (dir: 'give' | 'request') => (
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <ListingCreateForm
          worldSlug={worldSlug} header={null} direction={dir} title={title} onTitleChange={() => {}}
          summary="" onSummaryChange={() => {}} onPublished={onPublished} onPublishActionChange={() => {}}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(ui(direction));
  return { onPublished, rerender: (dir: 'give' | 'request') => view.rerender(ui(dir)) };
}
/** Taps Publish once the form has settled (the kind's default fields applied), as a member would. */
async function tapPublishWhenReady() {
  const button = await screen.findByTestId('listing-publish');
  await act(async () => {});
  fireEvent.click(button);
}

beforeEach(() => {
  mocks.listKindsForWorld.mockImplementation(async (world: string) => KINDS_BY_WORLD[world] ?? []);
  mocks.createListing.mockResolvedValue('listing-1');
});

// Vitest config sets `globals: false`, so testing-library's automatic cleanup is not wired.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ListingCreateForm — renders every category', () => {
  for (const world of ['rides', 'food', 'housing', 'time', 'animals', 'knowledge']) {
    it(`${world}: both directions render and a direction switch keeps the form alive`, async () => {
      const { rerender } = renderForm(world, 'give');
      expect(await screen.findByTestId('listing-publish')).toBeTruthy();
      rerender('request');
      expect(await screen.findByTestId('listing-publish')).toBeTruthy();
      // Rides have no title field (#1411); every other world keeps it.
      if (world === 'rides') expect(screen.queryByTestId('listing-title')).toBeNull();
      else expect(screen.getByTestId('listing-title')).toBeTruthy();
      // No inline native picker anywhere in the scrolling form.
      expect(mocks.nativeDatePicker).not.toHaveBeenCalled();
    });
  }

  it('describes the world in the description placeholder, not an item', async () => {
    renderForm('rides', 'give');
    const summary = await screen.findByTestId('listing-summary');
    expect(summary.getAttribute('placeholder')).toBe('post.unifiedCreate.descPlaceholder.rides');
  });

  it('shows the category-specific fields of the chosen direction', async () => {
    const { rerender } = renderForm('food', 'give');
    expect(await screen.findByTestId('listing-field-expires_at')).toBeTruthy();
    // The food type is the sub-category picker, not a detail field (D137, KC#1398).
    expect(screen.getByTestId('listing-subcategory-field')).toBeTruthy();
    expect(screen.queryByTestId('listing-field-food_type')).toBeNull();
    rerender('request');
    expect(await screen.findByTestId('listing-field-household_size')).toBeTruthy();
  });

  it('shows a retry message instead of an endless spinner when kinds fail to load', async () => {
    mocks.listKindsForWorld.mockResolvedValue([]);
    renderForm('time', 'give');
    expect(await screen.findByTestId('listing-kinds-error')).toBeTruthy();
    expect(screen.queryByTestId('listing-publish')).toBeNull();
  });
});

describe('ListingCreateForm — publish', () => {
  it('blocks publish with the first missing required field, shown inside that field', async () => {
    renderForm('food', 'give');
    await tapPublishWhenReady();
    // The expiry is the food offer's first required detail field now that food type left the form.
    const field = screen.getByTestId('listing-field-expires_at');
    expect((await within(field).findByTestId('listing-error')).textContent).toBe(
      'post.unifiedCreate.errors.fieldRequired:marketplace.field.expires_at',
    );
    expect(mocks.createListing).not.toHaveBeenCalled();
  });

  it('asks for a title before anything else, on the title field itself', async () => {
    renderForm('time', 'give', ' ');
    await tapPublishWhenReady();
    expect(await screen.findByText('post.unifiedCreate.errors.titleRequired')).toBeTruthy();
    // The title field draws its own error state; nothing is left above Publish.
    expect(screen.queryByTestId('listing-error')).toBeNull();
  });

  it('asks for a city next to the city picker', async () => {
    renderForm('time', 'give');
    await tapPublishWhenReady();
    const error = await screen.findByTestId('listing-error');
    expect(error.textContent).toBe('post.unifiedCreate.errors.cityRequired');
    expect(error.parentElement?.contains(screen.getByTestId('city-picker'))).toBe(true);
  });

  it('publishes a time offer with its default duration and city (the server places it)', async () => {
    const { onPublished } = renderForm('time', 'give');
    fireEvent.click(await screen.findByTestId('city-picker'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('listing-publish'));
    });
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith('listing-1'));
    expect(mocks.createListing).toHaveBeenCalledWith(
      expect.objectContaining({
        kindId: 'k-volunteer_offer',
        title: 'כותרת',
        details: { duration_minutes: 60 },
        cityId: '7000',
        lat: null,
        lng: null,
        externalBodyId: null,
      }),
    );
  });

  it('a ride needs its route before it can publish', async () => {
    renderForm('rides', 'give');
    await screen.findByTestId('listing-publish');
    // The ride section owns the route and the departure; there is no separate city picker.
    expect(screen.getByTestId('ride-section')).toBeTruthy();
    expect(screen.queryByTestId('city-picker')).toBeNull();
    await tapPublishWhenReady();
    // Only the missing origin is outlined, not the whole ride section.
    const origin = screen.getByTestId('ride-origin-frame');
    expect((await within(origin).findByTestId('listing-error')).textContent).toBe('marketplace.errors.ride_route_required');
    expect(screen.getAllByTestId('listing-error')).toHaveLength(1);
    expect(mocks.createListing).not.toHaveBeenCalled();
  });

  it('publishes a ride with its route, departure and seats, and remembers the route', async () => {
    const { onPublished } = renderForm('rides', 'give');
    fireEvent.click(await screen.findByTestId('ride-section-fill'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('listing-publish'));
    });
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith('listing-1'));
    const payload = mocks.createListing.mock.calls[0]![0] as { details: Record<string, unknown>; cityId: string; title: string };
    expect(payload.cityId).toBe('7000');
    // No title field: the title is built from the route, and no photo is needed (#1411).
    expect(payload.title).toBe('post.unifiedCreate.rideAutoTitle');
    expect(payload.details).toMatchObject({ ...RIDE_FILL, reward_model: 'free' });
    expect(payload.details).not.toHaveProperty('cost_share_ils');
    expect(mocks.rememberRideRoute).toHaveBeenCalledWith(expect.objectContaining(RIDE_FILL));
  });

  it('a recurring ride publishes a series and opens its first occurrence (FR-RIDE-046)', async () => {
    mocks.createRideSeries.mockResolvedValue({ seriesId: 'series-1', firstListingId: 'occurrence-1' });
    const { onPublished } = renderForm('rides', 'give');
    fireEvent.click(await screen.findByTestId('ride-section-fill'));
    fireEvent.click(screen.getByTestId('ride-section-recur'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('listing-publish'));
    });
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith('occurrence-1'));
    expect(mocks.createListing).not.toHaveBeenCalled();
    const input = mocks.createRideSeries.mock.calls[0]![0] as {
      kindId: string; details: Record<string, unknown>; schedule: { weekdays: number[]; time: string; endsOn: string | null }; durationMinutes: number | null;
    };
    expect(input.kindId).toBe('k-ride_offer');
    // The time of day of the departure, as the device shows it; the template carries no times.
    expect(input.schedule).toEqual({ weekdays: [0, 4], time: expect.stringMatching(/^\d{2}:\d{2}$/), endsOn: null });
    expect(input.details).not.toHaveProperty('departs_at');
    expect(input.details).toMatchObject({ origin_lat: RIDE_FILL.origin_lat, reward_model: 'free' });
    expect(mocks.rememberRideRoute).toHaveBeenCalled();
  });

  it('a recurring ride needs at least one weekday', async () => {
    renderForm('rides', 'give');
    fireEvent.click(await screen.findByTestId('ride-section-fill'));
    fireEvent.click(screen.getByTestId('ride-section-recur-nodays'));
    fireEvent.click(screen.getByTestId('listing-publish'));
    const recurrence = screen.getByTestId('ride-recurrence-frame');
    expect((await within(recurrence).findByTestId('listing-error')).textContent).toBe('rideSeries.errors.weekdaysRequired');
    expect(mocks.createRideSeries).not.toHaveBeenCalled();
  });

  it('keeps the ride route and departure when the direction switches', async () => {
    const { rerender } = renderForm('rides', 'give');
    fireEvent.click(await screen.findByTestId('ride-section-fill'));
    rerender('request');
    await act(async () => {
      fireEvent.click(await screen.findByTestId('listing-publish'));
    });
    const payload = mocks.createListing.mock.calls[0]![0] as { details: Record<string, unknown>; kindId: string };
    expect(payload.kindId).toBe('k-ride_request');
    expect(payload.details).toMatchObject({ origin_lat: RIDE_FILL.origin_lat, departs_at: RIDE_FILL.departs_at, passengers: 1 });
  });
});
