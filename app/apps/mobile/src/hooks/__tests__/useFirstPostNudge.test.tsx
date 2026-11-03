// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(), countOpenByUser: vi.fn(), dismiss: vi.fn(),
  user: { current: null as { firstPostNudgeDismissed: boolean } | null },
  dismissed: { current: false }, dismissSession: vi.fn(),
}));
vi.mock('../../services/userComposition', () => ({ getUserRepo: () => ({ findById: mocks.findById }) }));
vi.mock('../../services/postsComposition', () => ({
  getPostRepo: () => ({ countOpenByUser: mocks.countOpenByUser }),
  getDismissFirstPostNudgeUseCase: () => ({ execute: mocks.dismiss }),
}));
vi.mock('../../store/feedSessionStore', () => ({
  useFeedSessionStore: (selector: (state: { firstPostNudgeDismissedThisSession: boolean; dismissNudgeForSession: () => void }) => unknown) =>
    selector({ firstPostNudgeDismissedThisSession: mocks.dismissed.current, dismissNudgeForSession: mocks.dismissSession }),
}));

import { useFirstPostNudge } from '../useFirstPostNudge';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.findById.mockResolvedValue({ firstPostNudgeDismissed: false });
  mocks.countOpenByUser.mockResolvedValue(0);
  mocks.dismiss.mockResolvedValue(undefined);
  mocks.dismissed.current = false;
  vi.clearAllMocks();
});
afterEach(() => client.clear());

describe('useFirstPostNudge', () => {
  it('shows only for an eligible signed-in user with no open posts', async () => {
    const { result } = renderHook(() => useFirstPostNudge('u1'), { wrapper });
    await waitFor(() => expect(result.current.show).toBe(true));
    expect(mocks.findById).toHaveBeenCalledWith('u1');
    expect(mocks.countOpenByUser).toHaveBeenCalledWith('u1');
  });

  it('hides for signed-out, already dismissed, session-dismissed, or users with open posts', async () => {
    const guest = renderHook(() => useFirstPostNudge(null), { wrapper });
    expect(guest.result.current.show).toBe(false);
    expect(mocks.findById).not.toHaveBeenCalled();
    expect(mocks.countOpenByUser).not.toHaveBeenCalled();

    mocks.findById.mockResolvedValue({ firstPostNudgeDismissed: true });
    const dismissed = renderHook(() => useFirstPostNudge('u2'), { wrapper });
    await waitFor(() => expect(mocks.findById).toHaveBeenCalledWith('u2'));
    expect(dismissed.result.current.show).toBe(false);
    dismissed.unmount();

    mocks.findById.mockResolvedValue({ firstPostNudgeDismissed: false });
    mocks.dismissed.current = true;
    const session = renderHook(() => useFirstPostNudge('u3'), { wrapper });
    await waitFor(() => expect(mocks.countOpenByUser).toHaveBeenCalledWith('u3'));
    expect(session.result.current.show).toBe(false);
    session.unmount();

    mocks.dismissed.current = false;
    mocks.countOpenByUser.mockResolvedValue(1);
    const active = renderHook(() => useFirstPostNudge('u4'), { wrapper });
    await waitFor(() => expect(mocks.countOpenByUser).toHaveBeenCalledWith('u4'));
    expect(active.result.current.show).toBe(false);
  });

  it('dismisses for the session immediately and persists permanent dismissal then refetches', async () => {
    const { result } = renderHook(() => useFirstPostNudge('u1'), { wrapper });
    act(() => result.current.dismissForSession());
    expect(mocks.dismissSession).toHaveBeenCalledTimes(1);
    await act(async () => result.current.dismissForever());
    expect(mocks.dismiss).toHaveBeenCalledWith('u1');
    expect(mocks.findById).toHaveBeenCalledTimes(2);
  });

  it('skips permanent dismissal without a viewer and falls back to session dismissal on failure', async () => {
    const { result } = renderHook(() => useFirstPostNudge(null), { wrapper });
    await act(async () => result.current.dismissForever());
    expect(mocks.dismiss).not.toHaveBeenCalled();
    mocks.dismiss.mockRejectedValueOnce(new Error('offline'));
    const signedIn = renderHook(() => useFirstPostNudge('u1'), { wrapper });
    await act(async () => signedIn.result.current.dismissForever());
    expect(mocks.dismissSession).toHaveBeenCalledTimes(1);
  });
});
