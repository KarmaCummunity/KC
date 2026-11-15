// @vitest-environment jsdom
// KC#1310 — listing detail actions per viewer role, and a failed server action alerts instead of
// failing silently; #1412 — a known refusal gets its own copy, an unknown one is reported;
// FR-MOD-003 AC1 — a non-owner can block the owner and leaves the listing once blocked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { MarketplaceListingDetail } from '@kc/domain';

// The actions settle on a mocked promise, but under a loaded `pnpm test` (turbo runs every package at
// once) vi.waitFor's 1 s default is too tight: every wait here gets a roomy explicit timeout (#1841).
const SETTLE = { timeout: 5000 };
const push = vi.fn();
const startChat = vi.fn();
const back = vi.fn();
// The block hook is driven per test: who it targets, its state and what toggle resolves to.
const blockState = { canBlock: true, isBlocked: false, busy: false, toggle: vi.fn(async () => true) };
const blockTargets: string[] = [];

vi.mock('expo-router', () => ({ useRouter: () => ({ push, back, canGoBack: () => true }) }));
vi.mock('../../../hooks/useUserBlock', () => ({
  useUserBlock: (target: string) => {
    blockTargets.push(target);
    return { ...blockState, canBlock: blockState.canBlock && target !== '' };
  },
}));
// The kit buttons pull in reanimated and haptics; their press feedback is not under test here.
vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../../services/marketplaceComposition', () => ({
  marketplaceRepository: () => ({ startChat }),
}));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: vi.fn() }));
const captureException = vi.fn();
vi.mock('../../../lib/observability/sentry', () => ({ getSentryIfInit: () => ({ captureException }) }));

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
  feedHidden: false,
} as unknown as MarketplaceListingDetail;

function renderActions(
  viewerId: string | null,
  onReport = vi.fn(),
  detail: MarketplaceListingDetail = DETAIL,
  moderationInHeader = false,
) {
  const view = render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <ListingDetailActions
        detail={detail}
        viewerId={viewerId}
        onReport={onReport}
        moderationInHeader={moderationInHeader}
      />
    </ThemeProvider>,
  );
  return { ...view, onReport };
}

describe('ListingDetailActions', () => {
  it('shows a viewer message and report', () => {
    const { queryByTestId, onReport, getByTestId } = renderActions('u_viewer');

    expect(queryByTestId('listing-action-start-chat')).not.toBeNull();
    fireEvent.click(getByTestId('listing-action-report'));
    expect(onReport).toHaveBeenCalled();
  });

  it('shows the owner the link share, but not message or report', () => {
    const { queryByTestId } = renderActions('u_owner');

    expect(queryByTestId('listing-action-share-link')).not.toBeNull();
    expect(queryByTestId('listing-action-start-chat')).toBeNull();
    expect(queryByTestId('listing-action-report')).toBeNull();
  });

  it('opens the chat on success and explains a known refusal without reporting it', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    startChat.mockResolvedValueOnce('c_1').mockRejectedValueOnce(new Error('account_not_active'));
    const { getByTestId } = renderActions('u_viewer');

    fireEvent.click(getByTestId('listing-action-start-chat'));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/chat/c_1'), SETTLE);

    fireEvent.click(getByTestId('listing-action-start-chat'));
    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('marketplace.actionErrors.accountNotActive'), SETTLE);
    expect(captureException).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('still opens the chat when the server answers slower than vi.waitFor\'s 1 s default (#1841)', async () => {
    startChat.mockImplementationOnce(() => new Promise<string>((resolve) => setTimeout(() => resolve('c_slow'), 1300)));
    const { getByTestId } = renderActions('u_viewer');

    fireEvent.click(getByTestId('listing-action-start-chat'));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/chat/c_slow'), SETTLE);
  });

  it('shows the generic copy for an unknown failure and reports it with the action name', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const failure = Object.assign(new Error('permission denied for table chats'), { code: '42501' });
    startChat.mockRejectedValueOnce(failure);
    const { getByTestId } = renderActions('u_viewer');

    fireEvent.click(getByTestId('listing-action-start-chat'));
    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('marketplace.actionFailed'), SETTLE);
    expect(captureException).toHaveBeenCalledWith(failure, {
      tags: { area: 'listing_detail', action: 'start_chat', pg_code: '42501' },
    });
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
    await vi.waitFor(() => expect(message.getAttribute('aria-disabled')).toBe('true'), SETTLE);
    fireEvent.click(message);
    expect(startChat).toHaveBeenCalledTimes(1);

    finish('c_2');
    await vi.waitFor(() => expect(message.getAttribute('aria-disabled')).not.toBe('true'), SETTLE);
  });

  it('lets a non-owner block the owner and leaves the listing once the block lands', async () => {
    const { getByTestId } = renderActions('u_viewer');
    expect(blockTargets).toContain('u_owner');

    fireEvent.click(getByTestId('listing-action-block-owner'));
    await vi.waitFor(() => expect(back).toHaveBeenCalled(), SETTLE);
    expect(blockState.toggle).toHaveBeenCalledTimes(1);
  });

  it('hides share link, report and block when moderation moves to the post header', () => {
    const { queryByTestId } = renderActions('u_viewer', vi.fn(), DETAIL, true);

    expect(queryByTestId('listing-action-share-link')).toBeNull();
    expect(queryByTestId('listing-action-report')).toBeNull();
    expect(queryByTestId('listing-action-block-owner')).toBeNull();
    expect(queryByTestId('listing-action-start-chat')).not.toBeNull();
  });

  it('stays on the listing when the block is cancelled, and never offers the owner to block', async () => {
    blockState.toggle.mockResolvedValueOnce(false);
    const viewer = renderActions('u_viewer');
    fireEvent.click(viewer.getByTestId('listing-action-block-owner'));
    await vi.waitFor(() => expect(blockState.toggle).toHaveBeenCalled(), SETTLE);
    expect(back).not.toHaveBeenCalled();
    viewer.unmount();

    const owner = renderActions('u_owner');
    expect(owner.queryByTestId('listing-action-block-owner')).toBeNull();
  });
});
