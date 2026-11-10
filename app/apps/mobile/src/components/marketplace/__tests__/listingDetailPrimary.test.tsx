// @vitest-environment jsdom
// Spec 17 §8.1 call 6 — one primary call to action per screen. On the listing detail the flow
// action (reserve, claim, book a slot or a seat) is the primary, and "message the owner" is the
// primary only for a viewer with no flow action: a guest, a request listing, a world without a
// flow. The owner's share buttons are secondary, so the owner's detail shows no primary.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../giving/RidePlaceField', () => ({ RidePlaceField: () => null }));
vi.mock('../../../hooks/useRidePlaces', () => ({ useRidePlaces: () => ({ data: [], isLoading: false }) }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarVisibility: () => false, shellTabBarHeightPx: () => 0, useShellTabBarScrollInset: () => 0 }));
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { MarketplaceListingDetail } from '@kc/domain';

const { viewer } = vi.hoisted(() => ({ viewer: { id: 'u_viewer' as string | null } }));

vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) => select({ session: viewer.id ? { userId: viewer.id } : null }),
}));
vi.mock('../../../hooks/useMarketplaceListingDetail', () => ({ useSimilarListings: () => ({ data: [] }) }));
vi.mock('../../../services/listingImageUpload', () => ({ listingImagePublicUrl: (path: string) => path }));
vi.mock('../../../services/marketplaceComposition', () => ({ marketplaceRepository: () => ({}) }));
// No handoff or booking exists yet, so each flow offers its opening action.
vi.mock('../../../services/givingHandoffComposition', () => ({
  givingHandoffUseCases: { getForListing: () => ({ execute: async () => null }) },
}));
vi.mock('../../../services/rideBookingComposition', () => ({
  rideBookingUseCases: {},
  rideBookingsQueryKey: (listingId: string) => ['ride-bookings', listingId],
}));
vi.mock('../../../services/platformConfirm', () => ({ confirmAction: vi.fn().mockResolvedValue(false) }));
// The block-owner button's hook reaches the app container; blocking is covered in ListingDetailActions.test.
vi.mock('../../../hooks/useUserBlock', () => ({
  useUserBlock: () => ({ canBlock: false, isBlocked: false, busy: false, toggle: vi.fn() }),
}));
vi.mock('../../../services/ridesKnowledgeComposition', () => ({ ridesKnowledgeRpcs: {} }));
vi.mock('../../../services/knowledgeBookingComposition', () => {
  const slot = (id: string, days: number) => ({
    slotId: id,
    startsAt: new Date(Date.now() + days * 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + days * 86_400_000 + 3_600_000).toISOString(),
    capacity: 2,
    seatsLeft: 2,
    myHandoffId: null,
    myStatus: null,
  });
  return {
    knowledgeBookingUseCases: { listSlots: () => ({ execute: async () => [slot('slot-1', 1), slot('slot-2', 8)] }) },
    knowledgeSlotsQueryKey: (id: string) => ['knowledge-slots', id],
    knowledgeBookingsQueryKey: (id: string) => ['knowledge-bookings', id],
  };
});
vi.mock('../../../services/rideSafetyComposition', () => ({ raiseRideEmergency: vi.fn() }));
vi.mock('../../../lib/analytics', () => ({ track: vi.fn() }));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: vi.fn() }));
vi.mock('../../../lib/haptics', () => ({ hapticLightImpact: () => undefined, hapticSuccess: vi.fn() }));
vi.mock('../ReportListingModal', () => ({ ReportListingModal: () => null }));
vi.mock('../RideRouteCard', () => ({ RideRouteCard: () => null }));
// The housing stay section has its own tests (housing/__tests__); not the subject here.
vi.mock('../housing/HousingStayActions', () => ({ HousingStayActions: () => null }));
vi.mock('../../closure/OwnerAssignUserButton', () => ({ OwnerAssignUserButton: () => null }));
// The publisher card and the city lookup pull in Expo modules; neither holds a button.
vi.mock('../../post-detail/PublisherCard', () => ({ PublisherCard: () => null }));
vi.mock('../../../hooks/useCityName', () => ({ useCityName: () => null }));
vi.mock('../../cards/ListingCard', () => ({ formatRideTime: () => '' }));
// The kit buttons become plain buttons tagged with their variant, so the test counts primaries
// without reading styles.
vi.mock('../../ui/Buttons', () => {
  const tagged = (variant: string) =>
    function TaggedButton({ label, testID }: { readonly label: string; readonly testID?: string }) {
      return <button data-variant={variant} data-testid={testID}>{label}</button>;
    };
  return {
    PrimaryButton: tagged('primary'),
    SecondaryButton: tagged('secondary'),
    GhostButton: tagged('ghost'),
    DangerButton: tagged('danger'),
  };
});

import { MarketplaceListingDetailView } from '../MarketplaceListingDetailView';

afterEach(() => {
  cleanup();
  viewer.id = 'u_viewer';
});

const BASE = {
  listingId: 'l_1',
  ownerId: 'u_owner',
  worldSlug: 'items',
  worldLabelEn: 'Items',
  worldLabelHe: 'חפצים',
  kindSlug: 'offer',
  kindLabelEn: 'Offer',
  kindLabelHe: 'הצעה',
  direction: 'give',
  title: 'Bookshelf',
  summary: null,
  details: {},
  cityId: null,
  urgencyLevel: 0,
  availabilityStatus: 'available',
  publishedAt: null,
  lat: null,
  lng: null,
  maxRadiusKm: null,
  media: [],
  owner: null,
  feedPostId: null,
  feedHidden: false,
} satisfies MarketplaceListingDetail;

function renderDetail(overrides: Partial<MarketplaceListingDetail>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <MarketplaceListingDetailView detail={{ ...BASE, ...overrides }} bottomInset={0} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** The testIDs of the rendered primary buttons. */
const primaries = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-variant="primary"]')).map((el) => el.getAttribute('data-testid'));

describe('listing detail — one primary per screen', () => {
  it.each([
    ['items', 'giving-handoff-reserve'],
    ['food', 'giving-handoff-claim'],
    ['knowledge', 'knowledge-slot-book-slot-1'],
    ['rides', 'giving-handoff-book-seat'],
  ])('makes the %s flow action the only primary and the message button secondary', async (worldSlug, flowAction) => {
    // A knowledge offer books by time slot: a lesson with two upcoming times (#2034).
    const { container, findByTestId, getByTestId } = renderDetail(
      worldSlug === 'knowledge' ? { worldSlug, kindSlug: 'lesson_offer' } : { worldSlug },
    );
    await findByTestId(flowAction);

    expect(primaries(container)).toEqual([flowAction]);
    expect(getByTestId('listing-action-start-chat').getAttribute('data-variant')).toBe('secondary');
  });

  it.each([
    ['a world without a flow', { worldSlug: 'time' }, 'u_viewer'],
    ['a request listing', { direction: 'request' as const }, 'u_viewer'],
    ['a guest', {}, null],
  ])('makes the message button the only primary for %s', async (_case, overrides, viewerId) => {
    viewer.id = viewerId;
    const { container, findByTestId } = renderDetail(overrides);
    await findByTestId('listing-action-start-chat');
    // Let any flow query settle before counting.
    await waitFor(() => expect(primaries(container)).toEqual(['listing-action-start-chat']));
  });

  it('shows the owner no primary: the share buttons are secondary', async () => {
    viewer.id = 'u_owner';
    const { container, findByTestId } = renderDetail({});
    await findByTestId('listing-action-share-link');
    await waitFor(() => expect(primaries(container)).toEqual([]));
  });
});
