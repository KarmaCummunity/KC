// @vitest-environment jsdom
// Handoff actions on the kit buttons (spec 07 §7.7, spec 17 §4.1.1, TD-243): a requester reserves
// an item (pickup or delivery), and every action is blocked while one runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { MarketplaceListingDetail } from '@kc/domain';

let currentUserId = 'u_viewer';
const reserveItem = vi.fn();
const getForListing = vi.fn();
const confirmItem = vi.fn();
const cancelHandoff = vi.fn();
const markHandedOver = vi.fn();
const rateHandoff = vi.fn();

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) => select({ session: { userId: currentUserId } }),
}));
vi.mock('../../../services/givingHandoffComposition', () => ({
  givingHandoffUseCases: {
    getForListing: () => ({ execute: getForListing }),
    reserveItem: () => ({ execute: reserveItem }),
    confirmItem: () => ({ execute: confirmItem }),
    cancel: () => ({ execute: cancelHandoff }),
    markHandedOver: () => ({ execute: markHandedOver }),
    rate: () => ({ execute: rateHandoff }),
  },
}));
vi.mock('../../../services/ridesKnowledgeComposition', () => ({ ridesKnowledgeRpcs: {} }));
vi.mock('../../../lib/analytics', () => ({ track: vi.fn() }));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: vi.fn() }));
vi.mock('../../../lib/haptics', () => ({ hapticSuccess: vi.fn() }));
vi.mock('../../closure/OwnerAssignUserButton', () => ({ OwnerAssignUserButton: () => null }));

import { GivingHandoffActions } from '../GivingHandoffActions';
import { HandoffActionButton } from '../HandoffActionButton';

beforeEach(() => {
  currentUserId = 'u_viewer';
  vi.spyOn(globalThis, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ITEM = {
  listingId: 'l_item',
  ownerId: 'u_owner',
  worldSlug: 'items',
  direction: 'give',
  cityId: null,
  availabilityStatus: 'immediate',
} as unknown as MarketplaceListingDetail;

function renderInProviders(ui: React.ReactElement, qc?: QueryClient) {
  const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('HandoffActionButton', () => {
  it('presses through when idle and is blocked while an action of its flow runs', () => {
    const onPress = vi.fn();
    const idle = renderInProviders(<HandoffActionButton testID="act" label="Approve" busy={false} onPress={onPress} />);
    fireEvent.click(idle.getByRole('button', { name: 'Approve' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    cleanup();

    const { getByRole } = renderInProviders(
      <HandoffActionButton testID="act" label="Approve" busy secondary inRow onPress={onPress} />,
    );
    const busyButton = getByRole('button', { name: 'Approve' });
    expect(busyButton.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(busyButton);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('GivingHandoffActions', () => {
  it('reserves an item for pickup and blocks both reserve buttons until it settles', async () => {
    getForListing.mockResolvedValue(null);
    let settle: () => void = () => {};
    reserveItem.mockReturnValueOnce(new Promise<void>((resolve) => { settle = resolve; }));
    const { findByTestId, getByTestId } = renderInProviders(<GivingHandoffActions detail={ITEM} />);

    fireEvent.click(await findByTestId('giving-handoff-reserve'));
    expect(reserveItem).toHaveBeenCalledWith('l_item', 'pickup');
    await vi.waitFor(() =>
      expect(getByTestId('giving-handoff-reserve-delivery').getAttribute('aria-disabled')).toBe('true'),
    );
    fireEvent.click(getByTestId('giving-handoff-reserve-delivery'));
    expect(reserveItem).toHaveBeenCalledTimes(1);

    settle();
    await vi.waitFor(() =>
      expect(getByTestId('giving-handoff-reserve-delivery').getAttribute('aria-disabled')).not.toBe('true'),
    );
  });

  it('lets the owner assign a member before anyone reserved', async () => {
    getForListing.mockResolvedValue(null);
    currentUserId = 'u_owner';
    const owned = { ...ITEM, ownerId: 'u_owner' } as MarketplaceListingDetail;
    const { queryByTestId } = renderInProviders(<GivingHandoffActions detail={owned} />);
    expect(queryByTestId('giving-handoff')).not.toBeNull();
    expect(queryByTestId('giving-handoff-reserve')).toBeNull();
  });

  it('owner confirms reservation (selects recipient) and can decline/cancel', async () => {
    currentUserId = 'u_owner';
    getForListing.mockResolvedValue({
      handoffId: 'h_1',
      listingId: 'l_item',
      status: 'reserved',
      ownerId: 'u_owner',
      recipientId: 'u_recipient',
    });
    confirmItem.mockResolvedValue(undefined);
    cancelHandoff.mockResolvedValue(undefined);

    const { findByTestId } = renderInProviders(<GivingHandoffActions detail={ITEM} />);
    const confirmBtn = await findByTestId('giving-handoff-confirm');
    const cancelBtn = await findByTestId('giving-handoff-cancel');
    expect(confirmBtn).toBeTruthy();
    expect(cancelBtn).toBeTruthy();

    fireEvent.click(confirmBtn);
    expect(confirmItem).toHaveBeenCalledWith('h_1');
  });

  it('recipient can cancel their pending reservation', async () => {
    currentUserId = 'u_recipient';
    getForListing.mockResolvedValue({
      handoffId: 'h_1',
      listingId: 'l_item',
      status: 'reserved',
      ownerId: 'u_owner',
      recipientId: 'u_recipient',
    });
    cancelHandoff.mockResolvedValue(undefined);

    const { findByTestId, queryByTestId } = renderInProviders(<GivingHandoffActions detail={ITEM} />);
    expect(queryByTestId('giving-handoff-confirm')).toBeNull();
    const cancelBtn = await findByTestId('giving-handoff-cancel');
    fireEvent.click(cancelBtn);
    expect(cancelHandoff).toHaveBeenCalledWith('h_1');
  });

  it('completing a confirmed handoff invalidates feeds and details', async () => {
    currentUserId = 'u_owner';
    getForListing.mockResolvedValue({
      handoffId: 'h_1',
      listingId: 'l_item',
      status: 'confirmed',
      ownerId: 'u_owner',
      recipientId: 'u_recipient',
    });
    markHandedOver.mockResolvedValue(undefined);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { findByTestId } = renderInProviders(<GivingHandoffActions detail={ITEM} />, qc);
    const completeBtn = await findByTestId('giving-handoff-complete');
    fireEvent.click(completeBtn);
    expect(markHandedOver).toHaveBeenCalledWith('h_1');

    await vi.waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['feed'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['marketplace'] });
      // Every detail of the listing (by listing id or post id, 0561) and the post a hand-over closes (G34).
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['marketplace-detail'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['post'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['giving-handoffs'] });
    });
  });

  it('shows rating form when handoff is handed_over and submits feedback', async () => {
    currentUserId = 'u_owner';
    getForListing.mockResolvedValue({
      handoffId: 'h_1',
      listingId: 'l_item',
      status: 'handed_over',
      ownerId: 'u_owner',
      recipientId: 'u_recipient',
    });
    rateHandoff.mockResolvedValue(undefined);

    const { findByTestId } = renderInProviders(<GivingHandoffActions detail={ITEM} />);
    expect(await findByTestId('handoff-rating-form')).toBeTruthy();

    fireEvent.click(await findByTestId('handoff-rating-star-5'));
    fireEvent.click(await findByTestId('handoff-rating-submit'));
    expect(rateHandoff).toHaveBeenCalledWith('h_1', 5, null);
  });

  it('shows reserved status and hides reserve buttons if listing is scheduled', async () => {
    getForListing.mockResolvedValue(null);
    const scheduled = { ...ITEM, availabilityStatus: 'scheduled' } as MarketplaceListingDetail;
    const { findByTestId, queryByTestId } = renderInProviders(<GivingHandoffActions detail={scheduled} />);

    expect(await findByTestId('giving-handoff-status')).toBeTruthy();
    expect(queryByTestId('giving-handoff-reserve')).toBeNull();
  });

  it('shows handed over status and hides reserve buttons if listing is ongoing/closed', async () => {
    getForListing.mockResolvedValue(null);
    const ongoing = { ...ITEM, availabilityStatus: 'ongoing' } as MarketplaceListingDetail;
    const { findByTestId, queryByTestId } = renderInProviders(<GivingHandoffActions detail={ongoing} />);

    expect(await findByTestId('giving-handoff-status')).toBeTruthy();
    expect(queryByTestId('giving-handoff-reserve')).toBeNull();
  });
});
