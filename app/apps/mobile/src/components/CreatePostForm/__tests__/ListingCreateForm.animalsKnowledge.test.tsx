// @vitest-environment jsdom
// FR-POST-001 AC6 — the listing create form for knowledge (#1630) and animals (#1625):
// kind chooser in both directions, curated fields, and publishing.
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';

vi.hoisted(() => { (globalThis as { __DEV__?: boolean }).__DEV__ = false; });

import { KINDS_BY_WORLD } from '../../../lib/unifiedCreate/__tests__/listingKindFixtures';
import { ListingCreateForm } from '../ListingCreateForm';

const mocks = vi.hoisted(() => ({
  listKindsForWorld: vi.fn(),
  createListing: vi.fn(),
  nativeDatePicker: vi.fn(() => null),
  pickListingImages: vi.fn(async () => [] as { uri: string }[]),
  uploadListingImages: vi.fn(async () => [] as string[]),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.field ? `${k}:${String(o.field)}` : k),
    i18n: { language: 'he' },
  }),
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
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
vi.mock('../../giving/RideCreateSection', () => ({
  RIDE_CREATE_DETAIL_KEYS: [],
  RideCreateSection: () => null,
}));
vi.mock('../../../services/listingImageUpload', () => ({
  pickListingImages: mocks.pickListingImages,
  uploadListingImages: mocks.uploadListingImages,
}));
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

function renderForm(worldSlug: string, direction: 'give' | 'request', title = 'כותרת') {
  const onPublished = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (dir: 'give' | 'request') => (
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <ListingCreateForm
          worldSlug={worldSlug}
          header={null}
          direction={dir}
          title={title}
          onTitleChange={() => {}}
          summary=""
          onSummaryChange={() => {}}
          onPublished={onPublished}
          onPublishActionChange={() => {}}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(ui(direction));
  return { onPublished, rerender: (dir: 'give' | 'request') => view.rerender(ui(dir)) };
}

beforeEach(() => {
  mocks.listKindsForWorld.mockImplementation(async (world: string) => KINDS_BY_WORLD[world] ?? []);
  mocks.createListing.mockResolvedValue('listing-1');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ListingCreateForm — knowledge & animals (#1630, #1625)', () => {
  it('knowledge: shows kind chooser for give direction and required knowledge fields', async () => {
    const { rerender } = renderForm('knowledge', 'give');
    expect(await screen.findByTestId('listing-kind-chooser')).toBeTruthy();
    expect(screen.getByTestId('listing-kind-course')).toBeTruthy();
    expect(screen.getByTestId('listing-kind-private_lesson')).toBeTruthy();
    expect(screen.getByTestId('listing-field-topic')).toBeTruthy();
    expect(screen.getByTestId('listing-field-modality')).toBeTruthy();
    expect(screen.getByTestId('listing-field-slot_starts_at')).toBeTruthy();
    expect(screen.getByTestId('listing-field-slot_ends_at')).toBeTruthy();
    expect(screen.getByTestId('listing-field-slots_available')).toBeTruthy();
    rerender('request');
    expect(await screen.findByTestId('listing-field-topic')).toBeTruthy();
    expect(screen.getByTestId('listing-field-preferred_modality')).toBeTruthy();
    expect(screen.queryByTestId('listing-kind-chooser')).toBeNull();
  });

  it('animals: shows kind chooser in both directions with curated animal fields', async () => {
    const { rerender } = renderForm('animals', 'give');
    expect(await screen.findByTestId('listing-kind-chooser')).toBeTruthy();
    expect(screen.getByTestId('listing-kind-adoption_offer')).toBeTruthy();
    expect(screen.getByTestId('listing-kind-foster_offer')).toBeTruthy();
    expect(screen.getByTestId('listing-field-species')).toBeTruthy();
    expect(screen.getByTestId('listing-field-vaccinated')).toBeTruthy();
    rerender('request');
    expect(await screen.findByTestId('listing-kind-chooser')).toBeTruthy();
    expect(screen.getByTestId('listing-kind-adoption_request')).toBeTruthy();
    expect(screen.getByTestId('listing-kind-foster_request')).toBeTruthy();
    expect(screen.getByTestId('listing-field-species')).toBeTruthy();
    expect(screen.queryByTestId('listing-field-vaccinated')).toBeNull();
  });

  it('publishes an adoption offer with default species and city', async () => {
    const { onPublished } = renderForm('animals', 'give', 'כלבלב מתוק');
    fireEvent.click(await screen.findByTestId('city-picker'));
    // An animal offer needs a photo ({{D:offer-photo-required}}, KC#1937): refused at the photo picker first.
    await act(async () => {
      fireEvent.click(screen.getByTestId('listing-publish'));
    });
    expect(await screen.findByText('marketplace.errors.offer_photo_required')).toBeTruthy();
    expect(mocks.createListing).not.toHaveBeenCalled();
    mocks.pickListingImages.mockResolvedValueOnce([{ uri: 'file://puppy.jpg' }]);
    mocks.uploadListingImages.mockResolvedValueOnce(['u1/puppy.jpg']);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('post.addPhoto'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('listing-publish'));
    });
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith('listing-1'));
    expect(mocks.createListing).toHaveBeenCalledWith(
      expect.objectContaining({
        kindId: 'k-adoption_offer',
        title: 'כלבלב מתוק',
        details: expect.objectContaining({ species: 'dog' }),
        cityId: '7000',
        mediaPaths: ['u1/puppy.jpg'],
      }),
    );
  });
});
