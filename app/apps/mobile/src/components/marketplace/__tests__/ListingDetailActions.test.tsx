// @vitest-environment jsdom
// KC#1310 — listing detail actions per viewer role, and a failed server action alerts instead of
// failing silently.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { MarketplaceListingDetail } from '@kc/domain';

const push = vi.fn();
const startChat = vi.fn();
const shareToFeed = vi.fn();

vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
// The kit buttons pull in reanimated and haptics; their press feedback is not under test here.
vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../../services/marketplaceComposition', () => ({
  marketplaceRepository: () => ({ startChat, shareToFeed }),
}));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: vi.fn() }));

import { ListingDetailActions } from '../ListingDetailActions';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DETAIL = {
  listingId: 'l_1',
  ownerId: 'u_owner',
  worldSlug: 'items',
  cityId: null,
  title: 'Bookshelf',
  feedPostId: null,
} as unknown as MarketplaceListingDetail;

function renderActions(viewerId: string | null, onReport = vi.fn(), detail: MarketplaceListingDetail = DETAIL) {
  const view = render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <ListingDetailActions detail={detail} viewerId={viewerId} onReport={onReport} />
    </ThemeProvider>,
  );
  return { ...view, onReport };
}

describe('ListingDetailActions', () => {
  it('shows a viewer message and report, but not share to feed', () => {
    const { queryByTestId, onReport, getByTestId } = renderActions('u_viewer');

    expect(queryByTestId('listing-action-start-chat')).not.toBeNull();
    expect(queryByTestId('listing-action-share-feed')).toBeNull();
    fireEvent.click(getByTestId('listing-action-report'));
    expect(onReport).toHaveBeenCalled();
  });

  it('shows the owner share to feed, but not message or report', () => {
    const { queryByTestId } = renderActions('u_owner');

    expect(queryByTestId('listing-action-share-feed')).not.toBeNull();
    expect(queryByTestId('listing-action-start-chat')).toBeNull();
    expect(queryByTestId('listing-action-report')).toBeNull();
  });

  it('hides share to feed from the owner once the listing has a feed mirror (D-206)', () => {
    const mirrored = { ...DETAIL, feedPostId: 'p_mirror' } as MarketplaceListingDetail;
    const { queryByTestId } = renderActions('u_owner', vi.fn(), mirrored);

    expect(queryByTestId('listing-action-share-feed')).toBeNull();
    expect(queryByTestId('listing-action-share-link')).not.toBeNull();
  });

  it('opens the chat on success and alerts when the server refuses', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    startChat.mockResolvedValueOnce('c_1').mockRejectedValueOnce(new Error('account_not_active'));
    const { getByTestId } = renderActions('u_viewer');

    fireEvent.click(getByTestId('listing-action-start-chat'));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/chat/c_1'));

    fireEvent.click(getByTestId('listing-action-start-chat'));
    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('marketplace.actionFailed'));
    alert.mockRestore();
  });

  it('names each kit button by its label and blocks the message button while the chat opens', async () => {
    let finish: (chatId: string) => void = () => {};
    startChat.mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }));
    const { getByRole } = renderActions('u_viewer');
    const message = getByRole('button', { name: 'marketplace.startChat' });
    expect(getByRole('button', { name: 'marketplace.shareLink' })).toBeTruthy();
    expect(getByRole('button', { name: 'marketplace.report' })).toBeTruthy();

    fireEvent.click(message);
    await vi.waitFor(() => expect(message.getAttribute('aria-disabled')).toBe('true'));
    fireEvent.click(message);
    expect(startChat).toHaveBeenCalledTimes(1);

    finish('c_2');
    await vi.waitFor(() => expect(message.getAttribute('aria-disabled')).not.toBe('true'));
  });
});
