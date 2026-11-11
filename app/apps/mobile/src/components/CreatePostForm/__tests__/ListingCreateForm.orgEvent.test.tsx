// @vitest-environment jsdom
// G1 step 5 (docs/spec/08_organizations.md Events, D31) — the time world's offer form for a member
// of an organization: a volunteer shift by default, or the organization's event with its
// organization, window and registration policy, published through the one createListing path.
// A member of no organization sees today's form, with a hint how to publish an event (FR-ORG-002).
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import { KINDS_BY_WORLD } from '../../../lib/unifiedCreate/__tests__/listingKindFixtures';

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const WINDOW = { start: '2030-01-01T10:00:00.000Z', end: '2030-01-01T12:00:00.000Z' };

const mocks = vi.hoisted(() => ({
  listKindsForWorld: vi.fn(),
  listMyOrganizations: vi.fn(),
  createListing: vi.fn(),
  push: vi.fn(),
  // The instant each date field picks when tapped, by detail key.
  picks: {} as Record<string, string>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.field ? `${k}:${String(o.field)}` : k),
    i18n: { language: 'he' },
  }),
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// The organization membership hint (FR-ORG-002) opens My organizations.
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@react-native-community/datetimepicker', () => ({ default: () => null, DateTimePickerAndroid: { open: vi.fn() } }));
vi.mock('../../../services/marketplaceComposition', () => ({
  marketplaceRepository: () => ({
    listKindsForWorld: mocks.listKindsForWorld,
    listMyOrganizations: mocks.listMyOrganizations,
    createListing: mocks.createListing,
    listWorldSubcategories: async () => [],
  }),
}));
// Date field stand-in: one tap picks the instant set for its detail key.
vi.mock('../../ui/DateTimeField', () => ({
  DateTimeField: ({ testID, onChange }: { testID: string; onChange: (d: Date) => void }) => (
    <button type="button" data-testid={testID} onClick={() => onChange(new Date(mocks.picks[testID.replace('listing-date-', '')]!))} />
  ),
}));
vi.mock('../../giving/RideCreateSection', () => ({ RIDE_CREATE_DETAIL_KEYS: [], RideCreateSection: () => null }));
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
vi.mock('../../CityPicker', () => ({
  CityPicker: ({ onChange }: { onChange: (c: { id: string; name: string }) => void }) => (
    <button type="button" data-testid="city-picker" onClick={() => onChange({ id: '4000', name: 'חיפה' })} />
  ),
}));

import { ListingCreateForm } from '../ListingCreateForm';

function renderTimeOffer() {
  const onPublished = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <ListingCreateForm
          worldSlug="time"
          header={null}
          direction="give"
          title="יום ניקיון בחוף"
          onTitleChange={() => {}}
          summary=""
          onSummaryChange={() => {}}
          onPublished={onPublished}
          onPublishActionChange={() => {}}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onPublished };
}

/** Chooses the event, picks the window and the city. */
async function fillEvent() {
  fireEvent.click(await screen.findByTestId('time-offer-kind-event'));
  fireEvent.click(await screen.findByTestId('listing-date-starts_at'));
  fireEvent.click(screen.getByTestId('listing-date-ends_at'));
  fireEvent.click(screen.getByTestId('city-picker'));
}

async function publish() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('listing-publish'));
  });
}

beforeEach(() => {
  mocks.listKindsForWorld.mockImplementation(async (world: string) => KINDS_BY_WORLD[world] ?? []);
  mocks.listMyOrganizations.mockResolvedValue([{ orgId: ORG_A, name: 'Clean Coast' }]);
  mocks.createListing.mockResolvedValue('listing-event');
  mocks.picks.starts_at = WINDOW.start;
  mocks.picks.ends_at = WINDOW.end;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ListingCreateForm — organization event', () => {
  it('a member of no organization sees today\'s form', async () => {
    mocks.listMyOrganizations.mockResolvedValue([]);
    renderTimeOffer();
    expect(await screen.findByTestId('listing-field-duration_minutes')).toBeTruthy();
    await waitFor(() => expect(mocks.listMyOrganizations).toHaveBeenCalled());
    expect(screen.queryByTestId('time-offer-kind')).toBeNull();
  });

  it('tells a member of no organization how to publish an event, and opens My organizations', async () => {
    mocks.listMyOrganizations.mockResolvedValue([]);
    renderTimeOffer();
    fireEvent.click(await screen.findByTestId('org-event-membership-hint-open'));
    expect(mocks.push).toHaveBeenCalledWith('/settings/organizations');
  });

  it('shows a member of an organization no membership hint', async () => {
    renderTimeOffer();
    expect(await screen.findByTestId('time-offer-kind')).toBeTruthy();
    expect(screen.queryByTestId('org-event-membership-hint')).toBeNull();
  });

  it('defaults to a volunteer shift and switches to the event fields', async () => {
    renderTimeOffer();
    expect(await screen.findByTestId('time-offer-kind')).toBeTruthy();
    expect(screen.getByTestId('listing-field-duration_minutes')).toBeTruthy();
    fireEvent.click(screen.getByTestId('time-offer-kind-event'));
    expect(await screen.findByTestId('listing-field-registration_policy')).toBeTruthy();
    expect(screen.getByTestId('org-picker')).toBeTruthy();
    expect(screen.queryByTestId('listing-field-duration_minutes')).toBeNull();
  });

  it('publishes the event for the member\'s only organization', async () => {
    const { onPublished } = renderTimeOffer();
    await fillEvent();
    await publish();
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith('listing-event'));
    expect(mocks.createListing).toHaveBeenCalledWith(
      expect.objectContaining({
        kindId: 'k-org_event',
        cityId: '4000',
        details: { starts_at: WINDOW.start, ends_at: WINDOW.end, registration_policy: 'automatic', org_id: ORG_A },
      }),
    );
  });

  it('blocks an event that ends before it starts', async () => {
    mocks.picks.ends_at = '2030-01-01T09:00:00.000Z';
    renderTimeOffer();
    await fillEvent();
    await publish();
    expect((await screen.findByTestId('listing-error')).textContent).toBe('marketplace.errors.event_window_invalid');
    expect(mocks.createListing).not.toHaveBeenCalled();
  });

  it('asks a member of several organizations to pick one', async () => {
    mocks.listMyOrganizations.mockResolvedValue([
      { orgId: ORG_A, name: 'Clean Coast' },
      { orgId: ORG_B, name: 'Food Bank' },
    ]);
    renderTimeOffer();
    await fillEvent();
    await publish();
    expect((await screen.findByTestId('listing-error')).textContent).toBe('eventPost.create.orgRequired');
    fireEvent.click(screen.getByTestId(`org-picker-${ORG_B}`));
    await publish();
    await waitFor(() => expect(mocks.createListing).toHaveBeenCalled());
    const payload = mocks.createListing.mock.calls[0]![0] as { details: Record<string, unknown> };
    expect(payload.details.org_id).toBe(ORG_B);
  });
});
