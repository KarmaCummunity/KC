// @vitest-environment jsdom
// FR-KNOW-004 (#2034) — a knowledge lesson screen: the giver sees every booking and approves,
// declines, completes or cancels each; a learner picks a time, books a place and follows it.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarVisibility: () => false, shellTabBarHeightPx: () => 0, useShellTabBarScrollInset: () => 0 }));
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { KnowledgeBooking, KnowledgeSlot, MarketplaceListingDetail } from '@kc/domain';

const listSlots = vi.fn();
const listBookings = vi.fn();
const book = vi.fn();
const confirm = vi.fn();
const decline = vi.fn();
const complete = vi.fn();
const cancel = vi.fn();
const rate = vi.fn();
const routerPush = vi.fn();
const openKnowledgeLearnerChat = vi.fn();
let sessionUserId: string | null = 'u_giver';

vi.mock('expo-router', () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: Object.assign(
    (select: (s: unknown) => unknown) => select({ session: sessionUserId ? { userId: sessionUserId } : null }),
    { getState: () => ({ session: sessionUserId ? { userId: sessionUserId } : null }) },
  ),
}));
vi.mock('../../../services/knowledgeBookingComposition', () => ({
  knowledgeSlotsQueryKey: (id: string) => ['knowledge-slots', id],
  knowledgeBookingsQueryKey: (id: string) => ['knowledge-bookings', id],
  openKnowledgeLearnerChat: (...args: unknown[]) => openKnowledgeLearnerChat(...args),
  knowledgeBookingUseCases: {
    listSlots: () => ({ execute: listSlots }),
    listBookings: () => ({ execute: listBookings }),
    book: () => ({ execute: book }),
    confirm: () => ({ execute: confirm }),
    decline: () => ({ execute: decline }),
    complete: () => ({ execute: complete }),
  },
}));
vi.mock('../../../services/givingHandoffComposition', () => ({
  givingHandoffUseCases: { cancel: () => ({ execute: cancel }), rate: () => ({ execute: rate }) },
}));
vi.mock('../../../lib/analytics', () => ({ track: vi.fn() }));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: vi.fn() }));
vi.mock('../../../lib/haptics', () => ({ hapticLightImpact: () => undefined, hapticSuccess: vi.fn() }));
vi.mock('../../cards/ListingCard', () => ({ formatRideTime: (iso: string | null) => iso }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// The kit buttons become plain buttons tagged with their variant (as in listingDetailPrimary), so the
// test reads which action is primary; presses still reach the handler.
vi.mock('../../ui/Buttons', () => {
  const tagged = (variant: string) =>
    function TaggedButton({ label, testID, onPress }: { label: string; testID?: string; onPress?: () => void }) {
      return (
        <button data-variant={variant} data-testid={testID} onClick={onPress}>
          {label}
        </button>
      );
    };
  return { PrimaryButton: tagged('primary'), SecondaryButton: tagged('secondary') };
});

import { KnowledgeBookingActions, isBookableKnowledgeKind } from '../knowledge/KnowledgeBookingActions';

const HOUR = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

const DETAIL = {
  listingId: 'l1',
  worldSlug: 'knowledge',
  kindSlug: 'lesson_offer',
  direction: 'give',
  ownerId: 'u_giver',
  cityId: null,
} as unknown as MarketplaceListingDetail;

const slot = (overrides: Partial<KnowledgeSlot> = {}): KnowledgeSlot => ({
  slotId: 's1',
  startsAt: inHours(24),
  endsAt: inHours(25),
  capacity: 2,
  seatsLeft: 2,
  myHandoffId: null,
  myStatus: null,
  ...overrides,
});

const booking = (overrides: Partial<KnowledgeBooking> = {}): KnowledgeBooking => ({
  handoffId: 'h1',
  slotId: 's1',
  startsAt: inHours(24),
  endsAt: inHours(25),
  status: 'reserved',
  cancelReason: null,
  confirmBy: inHours(20),
  learnerId: 'u_learner',
  learnerName: 'Dana',
  learnerAvatarUrl: null,
  ...overrides,
});

function renderActions(detail: Partial<MarketplaceListingDetail> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <KnowledgeBookingActions detail={{ ...DETAIL, ...detail } as MarketplaceListingDetail} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionUserId = 'u_giver';
});

describe('KnowledgeBookingActions — who sees what', () => {
  it('books lessons, consulting hours and legacy one-slot posts by time, nothing else', () => {
    expect(isBookableKnowledgeKind('lesson_offer')).toBe(true);
    expect(isBookableKnowledgeKind('consulting_hour')).toBe(true);
    expect(isBookableKnowledgeKind('private_lesson')).toBe(true);
    expect(isBookableKnowledgeKind('mentoring_offer')).toBe(false);
  });

  it('shows nothing to a guest, on a request or on a mentoring offer', () => {
    sessionUserId = null;
    expect(renderActions().container.innerHTML).toBe('');
    cleanup();
    sessionUserId = 'u_learner';
    expect(renderActions({ direction: 'request' } as Partial<MarketplaceListingDetail>).container.innerHTML).toBe('');
    cleanup();
    expect(renderActions({ kindSlug: 'mentoring_offer' } as Partial<MarketplaceListingDetail>).container.innerHTML).toBe('');
  });
});

describe('KnowledgeSlotPicker — the learner', () => {
  it('books a place on a chosen time; only the soonest bookable time is the primary action', async () => {
    sessionUserId = 'u_learner';
    listSlots.mockResolvedValue([slot(), slot({ slotId: 's2', startsAt: inHours(48), endsAt: inHours(49) })]);
    book.mockResolvedValue('h-new');
    const { findByTestId, getByTestId } = renderActions();
    const first = await findByTestId('knowledge-slot-book-s1');
    expect(first.getAttribute('data-variant')).toBe('primary');
    expect(getByTestId('knowledge-slot-book-s2').getAttribute('data-variant')).toBe('secondary');
    fireEvent.click(first);
    await waitFor(() => expect(book).toHaveBeenCalledWith(expect.objectContaining({ slotId: 's1' })));
  });

  it('a full time cannot be booked; an own waiting booking can be cancelled', async () => {
    sessionUserId = 'u_learner';
    listSlots.mockResolvedValue([
      slot({ seatsLeft: 0 }),
      slot({ slotId: 's2', myHandoffId: 'h7', myStatus: 'reserved' }),
    ]);
    const { findByTestId, queryByTestId, getByText } = renderActions();
    await findByTestId('knowledge-my-booking-s2');
    expect(queryByTestId('knowledge-slot-book-s1')).toBeNull();
    expect(getByText('knowledgeBooking.full')).toBeTruthy();
    expect(queryByTestId('knowledge-my-booking-complete-s2')).toBeNull(); // a day ahead: not yet
    fireEvent.click(await findByTestId('knowledge-my-booking-cancel-s2'));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('h7'));
  });

  it('says so when there are no upcoming times', async () => {
    sessionUserId = 'u_learner';
    listSlots.mockResolvedValue([]);
    const { findByTestId } = renderActions();
    expect(await findByTestId('knowledge-slot-picker-empty')).toBeTruthy();
  });
});

describe('KnowledgeBookingsPanel — the giver', () => {
  it('approves or declines a waiting booking, with its deadline shown', async () => {
    listBookings.mockResolvedValue([booking()]);
    const { findByTestId, getByText } = renderActions();
    fireEvent.click(await findByTestId('knowledge-booking-confirm-h1'));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('h1'));
    expect(getByText('knowledgeBooking.answerBy')).toBeTruthy();
    fireEvent.click(await findByTestId('knowledge-booking-decline-h1'));
    await waitFor(() => expect(decline).toHaveBeenCalledWith('h1'));
  });

  it('completes an approved session once it is about to start, and can message the learner', async () => {
    listBookings.mockResolvedValue([booking({ status: 'confirmed', startsAt: inHours(0.1), confirmBy: null })]);
    openKnowledgeLearnerChat.mockResolvedValue('c9');
    const { findByTestId } = renderActions();
    fireEvent.click(await findByTestId('knowledge-booking-complete-h1'));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(expect.objectContaining({ handoffId: 'h1' })));
    fireEvent.click(await findByTestId('knowledge-booking-chat-h1'));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/chat/c9'));
    expect(openKnowledgeLearnerChat).toHaveBeenCalledWith('u_giver', 'u_learner');
  });

  it('shows why a cancelled booking ended and offers no action on it', async () => {
    listBookings.mockResolvedValue([booking({ status: 'cancelled', cancelReason: 'expired' })]);
    const { findByText, queryByTestId } = renderActions();
    expect(await findByText(/knowledgeBooking\.cancelReason\.expired/)).toBeTruthy();
    expect(queryByTestId('knowledge-booking-confirm-h1')).toBeNull();
    expect(queryByTestId('knowledge-booking-chat-h1')).toBeNull();
  });

  it('says so when there are no bookings', async () => {
    listBookings.mockResolvedValue([]);
    const { findByTestId } = renderActions();
    expect(await findByTestId('knowledge-bookings-empty')).toBeTruthy();
  });
});
