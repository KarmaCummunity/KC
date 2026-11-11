// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isBlocking: vi.fn<(blockerId: string, targetUserId: string) => Promise<boolean>>(),
  setBlocked: vi.fn(),
  userId: 'viewer-1' as string | null,
}));

vi.mock('../../lib/container', () => ({
  container: {
    blockRepo: { isBlocking: mocks.isBlocking },
    setUserBlocked: { execute: mocks.setBlocked },
  },
}));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (select: (state: { session: { userId: string } | null }) => unknown) =>
    select({ session: mocks.userId ? { userId: mocks.userId } : null }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { useUserBlock } from '../useUserBlock';

describe('useUserBlock', () => {
  let client: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userId = 'viewer-1';
    mocks.isBlocking.mockResolvedValue(false);
    mocks.setBlocked.mockResolvedValue(undefined);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());
  });

  it('loads current block state for another user', async () => {
    mocks.isBlocking.mockResolvedValue(true);
    const { result } = renderHook(() => useUserBlock('target-1'), { wrapper });

    await waitFor(() => expect(result.current.isBlocked).toBe(true));
    expect(result.current.canBlock).toBe(true);
    expect(mocks.isBlocking).toHaveBeenCalledWith('viewer-1', 'target-1');
  });

  it('does not query or allow blocking for a guest or self', () => {
    mocks.userId = null;
    const guest = renderHook(() => useUserBlock('target-1'), { wrapper });
    expect(guest.result.current.canBlock).toBe(false);
    guest.unmount();

    mocks.userId = 'viewer-1';
    const self = renderHook(() => useUserBlock('viewer-1'), { wrapper });
    expect(self.result.current.canBlock).toBe(false);
    expect(mocks.isBlocking).not.toHaveBeenCalled();
  });

  it('confirms, blocks, updates the cached state, and notifies', async () => {
    mocks.isBlocking.mockResolvedValueOnce(false).mockResolvedValue(true);
    const { result } = renderHook(() => useUserBlock('target-1'), { wrapper });
    await waitFor(() => expect(mocks.isBlocking).toHaveBeenCalled());

    await act(async () => result.current.toggle());

    expect(mocks.setBlocked).toHaveBeenCalledWith({ blockerId: 'viewer-1', targetUserId: 'target-1', blocked: true });
    expect(result.current.isBlocked).toBe(true);
    expect(globalThis.confirm).toHaveBeenCalledWith(
      'moderation.block.confirmBlockTitle\n\nmoderation.block.confirmBlockBody',
    );
    expect(globalThis.alert).toHaveBeenCalledWith('moderation.block.blockedToast');
    expect(result.current.busy).toBe(false);
  });

  it('leaves state unchanged when confirmation is cancelled and reports mutation failures', async () => {
    vi.mocked(globalThis.confirm).mockReturnValueOnce(false);
    const { result } = renderHook(() => useUserBlock('target-1'), { wrapper });
    await waitFor(() => expect(mocks.isBlocking).toHaveBeenCalled());

    await act(async () => result.current.toggle());
    expect(mocks.setBlocked).not.toHaveBeenCalled();
    expect(result.current.isBlocked).toBe(false);

    mocks.setBlocked.mockRejectedValueOnce(new Error('offline'));
    await act(async () => result.current.toggle());
    expect(globalThis.alert).toHaveBeenCalledWith('moderation.block.failed');
    expect(result.current.isBlocked).toBe(false);
    expect(result.current.busy).toBe(false);
  });
});
