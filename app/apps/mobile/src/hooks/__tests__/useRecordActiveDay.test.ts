// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { userId, execute, recordOnce, addEventListener, remove } = vi.hoisted(() => ({
  userId: { current: null as string | null },
  execute: vi.fn(async () => undefined),
  recordOnce: vi.fn(async (_userId: string, record: () => Promise<void>) => record()),
  addEventListener: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (state: { session: { userId: string } | null }) => unknown) =>
    selector({ session: userId.current ? { userId: userId.current } : null }),
}));
vi.mock('../../lib/container', () => ({ container: { recordActiveDay: { execute } } }));
vi.mock('../../lib/activeDay', () => ({ recordActiveDayOncePerDay: recordOnce }));
vi.mock('react-native', () => ({
  AppState: { addEventListener },
}));

import { useRecordActiveDay } from '../useRecordActiveDay';

beforeEach(() => {
  userId.current = null;
  execute.mockClear();
  recordOnce.mockClear();
  remove.mockClear();
  addEventListener.mockReset();
  addEventListener.mockReturnValue({ remove });
});
afterEach(() => vi.clearAllMocks());

describe('useRecordActiveDay', () => {
  it('does nothing without a signed-in user', () => {
    renderHook(() => useRecordActiveDay());
    expect(recordOnce).not.toHaveBeenCalled();
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it('records on mount and each active transition, ignoring other states, then removes the listener', () => {
    userId.current = 'user-1';
    let listener: ((state: string) => void) | undefined;
    addEventListener.mockImplementation((_event: string, callback: (state: string) => void) => {
      listener = callback;
      return { remove };
    });
    const { unmount } = renderHook(() => useRecordActiveDay());
    expect(recordOnce).toHaveBeenCalledTimes(1);
    expect(recordOnce).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(execute).toHaveBeenCalledTimes(1);
    act(() => listener?.('background'));
    expect(recordOnce).toHaveBeenCalledTimes(1);
    act(() => listener?.('active'));
    expect(recordOnce).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('rebinds for a changed user and cleans up the prior subscription', () => {
    userId.current = 'first';
    const { rerender, unmount } = renderHook(() => useRecordActiveDay());
    userId.current = 'second';
    rerender();
    expect(recordOnce).toHaveBeenNthCalledWith(1, 'first', expect.any(Function));
    expect(recordOnce).toHaveBeenNthCalledWith(2, 'second', expect.any(Function));
    expect(remove).toHaveBeenCalledTimes(1);
    unmount();
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
