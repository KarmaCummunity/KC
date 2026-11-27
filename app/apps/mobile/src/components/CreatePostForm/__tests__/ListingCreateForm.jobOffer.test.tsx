// @vitest-environment jsdom
// docs/spec/05_giving_worlds.md §5.11 (#1476) — a job offer is published in the name of an
// organization allowed to post jobs; looking for work needs no organization.
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import { KINDS_BY_WORLD } from '../../../lib/unifiedCreate/__tests__/listingKindFixtures';

const EMPLOYER = { orgId: '00000000-0000-0000-0000-00000000000a', name: 'Employer', mayPostJobs: true };
const SECOND = { orgId: '00000000-0000-0000-0000-00000000000b', name: 'Second employer', mayPostJobs: true };
const CLUB = { orgId: '00000000-0000-0000-0000-00000000000c', name: 'Club', mayPostJobs: false };

const mocks = vi.hoisted(() => ({
  listKindsForWorld: vi.fn(),
  listMyOrganizations: vi.fn(),
  createListing: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.field ? `${k}:${String(o.field)}` : k),
    i18n: { language: 'he' },
  }),
}));
// The photo tiles render through KCImage (expo-image), a native module.
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@react-native-community/datetimepicker', () => ({ default: () => null, DateTimePickerAndroid: { open: vi.fn() } }));
vi.mock('../../../services/marketplaceComposition', () => ({
  marketplaceRepository: () => ({
    listKindsForWorld: mocks.listKindsForWorld,
    listMyOrganizations: mocks.listMyOrganizations,
    createListing: mocks.createListing,
    listWorldSubcategories: async () => [],
  }),
}));
vi.mock('../../giving/RideCreateSection', () => ({ RIDE_CREATE_DETAIL_KEYS: [], RideCreateSection: () => null }));
vi.mock('../../../services/listingImageUpload', () => ({ pickListingImages: vi.fn(async () => ({ status: 'ok' as const, value: [] })), uploadListingImages: vi.fn() }));
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

// The form's audience / address-level and street-address services (FR-POST-003, KC#2288).
vi.mock('../../../services/postsComposition', async () => (await import('../../../lib/unifiedCreate/__tests__/listingExposureDoubles')).postsCompositionDouble);
vi.mock('../../../services/userComposition', async () => (await import('../../../lib/unifiedCreate/__tests__/listingExposureDoubles')).userCompositionDouble);
vi.mock('../../StreetPicker', () => ({ StreetPicker: () => null }));
vi.mock('../../../services/listingStreetAddressComposition', () => ({
  listingStreetAddressUseCases: {
    save: () => ({ execute: vi.fn() }),
    getOwn: () => ({ execute: async () => null }),
  },
  listingStreetAddressQueryKey: (id: string) => ['listing-street-address', id],
}));

import { ListingCreateForm } from '../ListingCreateForm';

function renderEmployment(direction: 'give' | 'request') {
  const onPublished = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <ListingCreateForm
          worldSlug="employment"
          header={null}
          direction={direction}
          title="רכז/ת מתנדבים"
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

/** Types the role and picks the city: the form's other required parts. */
async function fillJob() {
  const role = (await screen.findByTestId('listing-field-role')).querySelector('input')!;
  fireEvent.change(role, { target: { value: 'Coordinator' } });
  fireEvent.click(screen.getByTestId('city-picker'));
}

async function publish() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('listing-publish'));
  });
}

beforeEach(() => {
  mocks.listKindsForWorld.mockImplementation(async (world: string) => KINDS_BY_WORLD[world] ?? []);
  mocks.listMyOrganizations.mockResolvedValue([EMPLOYER, CLUB]);
  mocks.createListing.mockResolvedValue('listing-job');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ListingCreateForm — job offer organization (§5.11)', () => {
  it('publishes a job offer for the member\'s only organization allowed to post jobs', async () => {
    const { onPublished } = renderEmployment('give');
    await fillJob();
    // The club may not post jobs, so it is not offered.
    expect(await screen.findByTestId(`org-picker-${EMPLOYER.orgId}`)).toBeTruthy();
    expect(screen.queryByTestId(`org-picker-${CLUB.orgId}`)).toBeNull();
    await publish();
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith('listing-job'));
    const payload = mocks.createListing.mock.calls[0]![0] as { kindId: string; details: Record<string, unknown> };
    expect(payload.kindId).toBe('k-job_offer');
    expect(payload.details.org_id).toBe(EMPLOYER.orgId);
  });

  it('asks a member with several allowed organizations to pick one', async () => {
    mocks.listMyOrganizations.mockResolvedValue([EMPLOYER, SECOND]);
    renderEmployment('give');
    await fillJob();
    await screen.findByTestId(`org-picker-${SECOND.orgId}`);
    await publish();
    expect((await screen.findByTestId('listing-error')).textContent).toBe('jobOffer.create.orgRequired');
    fireEvent.click(screen.getByTestId(`org-picker-${SECOND.orgId}`));
    await publish();
    await waitFor(() => expect(mocks.createListing).toHaveBeenCalled());
    expect((mocks.createListing.mock.calls[0]![0] as { details: Record<string, unknown> }).details.org_id).toBe(SECOND.orgId);
  });

  it('tells a member with no allowed organization why they cannot offer a job, and does not publish', async () => {
    mocks.listMyOrganizations.mockResolvedValue([CLUB]);
    renderEmployment('give');
    await fillJob();
    expect(await screen.findByTestId('job-offer-no-org')).toBeTruthy();
    expect(screen.queryByTestId('org-picker')).toBeNull();
    await publish();
    expect((await screen.findByTestId('listing-error')).textContent).toBe('jobOffer.create.noEligibleOrg');
    expect(mocks.createListing).not.toHaveBeenCalled();
  });

  it('lets every member say they are looking for work, with no organization', async () => {
    mocks.listMyOrganizations.mockResolvedValue([]);
    const { onPublished } = renderEmployment('request');
    await fillJob();
    await publish();
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith('listing-job'));
    const payload = mocks.createListing.mock.calls[0]![0] as { kindId: string; details: Record<string, unknown> };
    expect(payload.kindId).toBe('k-job_request');
    expect(payload.details).not.toHaveProperty('org_id');
    expect(screen.queryByTestId('job-offer-no-org')).toBeNull();
  });
});
