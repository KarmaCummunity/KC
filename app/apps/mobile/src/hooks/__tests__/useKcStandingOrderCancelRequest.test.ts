// @vitest-environment jsdom
// FR-DONATE-011 — written standing-order cancellation request via the support thread.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// vi.mock factories are hoisted above imports, so their spies must be hoisted too.
const { session, confirm, push, getSupportThread, sendMessage } = vi.hoisted(() => ({
  session: { current: { userId: 'u1' } as { userId: string } | null },
  confirm: vi.fn(async () => true),
  push: vi.fn(),
  getSupportThread: vi.fn(async () => ({ chatId: 'c1' })),
  sendMessage: vi.fn(async () => ({})),
}));

vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../services/platformConfirm', () => ({ confirmAction: confirm }));
vi.mock('../../lib/container', () => ({
  container: { getSupportThread: { execute: getSupportThread }, sendMessage: { execute: sendMessage } },
}));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: { session: { userId: string } | null }) => unknown) => sel({ session: session.current }),
}));

import { useKcStandingOrderCancelRequest } from '../useKcStandingOrderCancelRequest';

beforeEach(() => {
  vi.clearAllMocks();
  session.current = { userId: 'u1' };
  confirm.mockResolvedValue(true);
  sendMessage.mockResolvedValue({});
});

describe('useKcStandingOrderCancelRequest', () => {
  it('posts the fixed request to the support thread and opens that chat', async () => {
    const { result } = renderHook(() => useKcStandingOrderCancelRequest());
    await act(() => result.current.request());
    expect(getSupportThread).toHaveBeenCalledWith({ userId: 'u1' });
    expect(sendMessage).toHaveBeenCalledWith({ chatId: 'c1', senderId: 'u1', body: 'supportKc.cancelMessage' });
    expect(push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'c1' } });
    expect(result.current.failed).toBe(false);
  });

  it('sends nothing when the donor dismisses the confirmation', async () => {
    confirm.mockResolvedValue(false);
    const { result } = renderHook(() => useKcStandingOrderCancelRequest());
    await act(() => result.current.request());
    expect(sendMessage).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('flags a failure and stays on the screen when sending fails', async () => {
    sendMessage.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useKcStandingOrderCancelRequest());
    await act(() => result.current.request());
    expect(result.current.failed).toBe(true);
    expect(result.current.busy).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('is unavailable to signed-out viewers', async () => {
    session.current = null;
    const { result } = renderHook(() => useKcStandingOrderCancelRequest());
    expect(result.current.canRequest).toBe(false);
    await act(() => result.current.request());
    expect(confirm).not.toHaveBeenCalled();
  });
});
