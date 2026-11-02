// @vitest-environment jsdom
// Owner call to action on post detail, on the kit buttons (FR-CLOSURE-001 / 005, spec 17 §4.1.1, TD-243):
// an open post starts the closure, a closed one asks to reopen, a terminal one shows nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Post } from '@kc/domain';

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../services/postMessages', () => ({ mapPostErrorToHebrew: (code: string) => code }));
vi.mock('../../../lib/trackSocialHandoverCompleted', () => ({ trackSocialHandoverCompleted: () => {} }));
vi.mock('../../../services/postsComposition', () => ({
  getReopenPostUseCase: () => ({ execute: () => Promise.resolve() }),
  getGetClosureCandidatesUseCase: () => ({ execute: () => Promise.resolve([]) }),
  getMarkAsDeliveredUseCase: () => ({ execute: () => Promise.resolve() }),
}));
vi.mock('../../../services/userComposition', () => ({
  getDismissClosureExplainerUseCase: () => ({ execute: () => Promise.resolve() }),
  getSearchUsersForClosureUseCase: () => ({ execute: () => Promise.resolve([]) }),
}));
// The flow's sheets and dialog have their own tests; the reopen dialog reports whether it is open.
vi.mock('../ClosureSheet', () => ({ ClosureSheet: () => null }));
vi.mock('../ClosureExplainerSheet', () => ({ ClosureExplainerSheet: () => null }));
vi.mock('../ReopenConfirmModal', () => ({
  ReopenConfirmModal: ({ visible }: { visible: boolean }) => (visible ? <span data-testid="reopen-dialog" /> : null),
}));

import { OwnerActionsBar } from '../OwnerActionsBar';
import { useClosureStore } from '../../../store/closureStore';
import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';

const OPEN_GIVE = { postId: 'p_1', type: 'Give', status: 'open', deleteAfter: null } as unknown as Post;

function renderBar(post: Post) {
  return renderInTheme(
    <QueryClientProvider client={new QueryClient()}>
      <OwnerActionsBar post={post} ownerId="u_owner" onClosed={() => {}} onReopened={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => useClosureStore.getState().reset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OwnerActionsBar', () => {
  it('starts the closure from the primary action of an open post', () => {
    const start = vi.fn();
    useClosureStore.setState({ start });
    const { getByRole } = renderBar(OPEN_GIVE);
    fireEvent.click(getByRole('button', { name: 'closure.markGiveCta' }));
    expect(start).toHaveBeenCalledWith('p_1', 'u_owner', 'Give', { initiator: 'post-detail' });
  });

  it('holds the closure action while a closure is already running', () => {
    const start = vi.fn();
    useClosureStore.setState({ start, isBusy: true });
    const { getByRole } = renderBar(OPEN_GIVE);
    const button = getByRole('button', { name: 'closure.markGiveCta' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(start).not.toHaveBeenCalled();
  });

  it('asks to reopen a delivered post from the secondary action, then holds it', () => {
    const { getByRole, getByTestId } = renderBar({ ...OPEN_GIVE, status: 'closed_delivered' } as Post);
    const reopen = getByRole('button', { name: 'closure.itemNotDeliveredA11y' });
    fireEvent.click(reopen);
    expect(getByTestId('reopen-dialog')).toBeTruthy();
    expect(reopen.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows no action for a post in a terminal state', () => {
    const { queryByRole } = renderBar({ ...OPEN_GIVE, status: 'removed_admin' } as Post);
    expect(queryByRole('button')).toBeNull();
  });
});
