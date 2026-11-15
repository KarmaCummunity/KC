// @vitest-environment jsdom
// useBlockedUsers (FR-MOD-004): the Blocked Users list loads from the use case, unblocking asks
// first and then removes the block and refreshes, a cancelled confirm changes nothing, and a
// failure is explained instead of thrown.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackendUnavailableError } from '@kc/domain';

const m = vi.hoisted(() => ({
  list: vi.fn(),
  setBlocked: vi.fn(),
  alert: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, Alert: { alert: m.alert } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/container', () => ({
  container: { listMyBlockedUsers: { execute: m.list }, setUserBlocked: { execute: m.setBlocked } },
}));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (select: (s: { session: { userId: string } }) => unknown) => select({ session: { userId: 'me' } }),
}));

import { useBlockedUsers } from '../useBlockedUsers';

const ROW = { userId: 'u_blocked', displayName: 'Blocked', avatarUrl: null, blockedAt: '2026-11-03T10:00:00Z' };

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Answers the next native confirm with the button at `index` (0 = cancel, 1 = unblock). */
function answerConfirm(index: number) {
  m.alert.mockImplementationOnce((_t: string, _b: string, buttons: Array<{ onPress?: () => void }>) => {
    buttons[index]?.onPress?.();
  });
}

describe('useBlockedUsers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the blocked members', async () => {
    m.list.mockResolvedValue([ROW]);
    const { result } = renderHook(() => useBlockedUsers(), { wrapper });
    await waitFor(() => expect(result.current.users).toEqual([ROW]));
  });

  it('degrades to an empty, flagged list when the backend lacks list_my_blocked_users', async () => {
    m.list.mockRejectedValue(new BackendUnavailableError('rpc:list_my_blocked_users', 'function'));
    const { result } = renderHook(() => useBlockedUsers(), { wrapper });
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.users).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('still reports an unexpected failure as an error, not as an empty list', async () => {
    m.list.mockRejectedValue(new Error('timeout'));
    const { result } = renderHook(() => useBlockedUsers(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.unavailable).toBe(false);
  });

  it('unblocks after the confirm and tells the member', async () => {
    m.list.mockResolvedValue([ROW]);
    m.setBlocked.mockResolvedValue(undefined);
    const { result } = renderHook(() => useBlockedUsers(), { wrapper });
    await waitFor(() => expect(result.current.users).toHaveLength(1));

    answerConfirm(1);
    await act(() => result.current.unblock(ROW));

    expect(m.setBlocked).toHaveBeenCalledWith({ blockerId: 'me', targetUserId: 'u_blocked', blocked: false });
    expect(m.alert).toHaveBeenLastCalledWith('', 'moderation.block.unblockedToast');
    expect(result.current.busyId).toBeNull();
  });

  it('does nothing when the confirm is cancelled', async () => {
    m.list.mockResolvedValue([ROW]);
    const { result } = renderHook(() => useBlockedUsers(), { wrapper });
    await waitFor(() => expect(result.current.users).toHaveLength(1));

    answerConfirm(0);
    await act(() => result.current.unblock(ROW));

    expect(m.setBlocked).not.toHaveBeenCalled();
  });

  it('explains a failed unblock', async () => {
    m.list.mockResolvedValue([ROW]);
    m.setBlocked.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useBlockedUsers(), { wrapper });
    await waitFor(() => expect(result.current.users).toHaveLength(1));

    answerConfirm(1);
    await act(() => result.current.unblock(ROW));

    expect(m.alert).toHaveBeenLastCalledWith('', 'moderation.block.failed');
  });
});
