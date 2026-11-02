// @vitest-environment jsdom
// Handoff actions on the kit buttons (spec 07 §7.7, spec 17 §4.1.1, TD-243): a requester reserves
// an item (pickup or delivery), and every action is blocked while one runs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { MarketplaceListingDetail } from '@kc/domain';

const reserveItem = vi.fn();
const getForListing = vi.fn();

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) => select({ session: { userId: 'u_viewer' } }),
}));
vi.mock('../../../services/givingHandoffComposition', () => ({
  givingHandoffUseCases: {
    getForListing: () => ({ execute: getForListing }),
    reserveItem: () => ({ execute: reserveItem }),
  },
}));
vi.mock('../../../services/ridesKnowledgeComposition', () => ({ ridesKnowledgeRpcs: {} }));
vi.mock('../../../lib/analytics', () => ({ track: vi.fn() }));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: vi.fn() }));
vi.mock('../../../lib/haptics', () => ({ hapticSuccess: vi.fn() }));

import { GivingHandoffActions } from '../GivingHandoffActions';
import { HandoffActionButton } from '../HandoffActionButton';

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
} as unknown as MarketplaceListingDetail;

function renderInProviders(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

  it('shows nothing to the owner before anyone reserved', async () => {
    getForListing.mockResolvedValue(null);
    const owned = { ...ITEM, ownerId: 'u_viewer' } as MarketplaceListingDetail;
    const { queryByTestId } = renderInProviders(<GivingHandoffActions detail={owned} />);
    expect(queryByTestId('giving-handoff')).toBeNull();
  });
});
