// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationPreferences } from '@kc/domain';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(), execute: vi.fn(), userId: { current: 'u1' as string | undefined },
}));
vi.mock('../../lib/container', () => ({
  container: { userRepo: { findById: mocks.findById }, updateNotificationPreferences: { execute: mocks.execute } },
}));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (state: { session: { userId: string } | null }) => unknown) =>
    selector({ session: mocks.userId.current ? { userId: mocks.userId.current } : null }),
}));

import { DEFAULT_NOTIFICATION_PREFS, useNotificationPreferences } from '../useNotificationPreferences';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const preferences: NotificationPreferences = { critical: true, social: false, quietHours: { enabled: true, start: '21:00', end: '06:00', timezone: 'UTC' } };

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mocks.userId.current = 'u1';
  mocks.findById.mockResolvedValue({ notificationPreferences: preferences });
  mocks.execute.mockResolvedValue(undefined);
});
afterEach(() => { client.clear(); vi.clearAllMocks(); });

describe('useNotificationPreferences', () => {
  it('loads stored preferences for the current user', async () => {
    const { result } = renderHook(() => useNotificationPreferences(), { wrapper });
    await waitFor(() => expect(result.current.prefs).toEqual(preferences));
    expect(mocks.findById).toHaveBeenCalledWith('u1');
  });

  it('uses defaults when the user has no saved preferences and does not query signed-out users', async () => {
    mocks.findById.mockResolvedValue(null);
    const { result, rerender } = renderHook(() => useNotificationPreferences(), { wrapper });
    await waitFor(() => expect(mocks.findById).toHaveBeenCalledWith('u1'));
    expect(result.current.prefs).toEqual(DEFAULT_NOTIFICATION_PREFS);
    rerender();
    expect(result.current.prefs).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it('applies optimistic updates, executes the exact request, and invalidates the query', async () => {
    const { result } = renderHook(() => useNotificationPreferences(), { wrapper });
    await waitFor(() => expect(result.current.prefs).toEqual(preferences));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    let finishMutation: (() => void) | undefined;
    mocks.execute.mockImplementationOnce(() => new Promise<void>((resolve) => { finishMutation = resolve; }));
    act(() => result.current.update({ social: true }));
    await waitFor(() => expect(result.current.prefs.social).toBe(true));
    expect(mocks.execute).toHaveBeenCalledWith({ userId: 'u1', social: true });
    await act(async () => finishMutation?.());
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notification-preferences', 'u1'] }));
  });

  it('rolls back a failed optimistic update and still invalidates', async () => {
    const { result } = renderHook(() => useNotificationPreferences(), { wrapper });
    await waitFor(() => expect(result.current.prefs).toEqual(preferences));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    mocks.execute.mockRejectedValueOnce(new Error('offline'));
    act(() => result.current.update({ social: true }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalled());
    await waitFor(() => expect(result.current.prefs).toEqual(preferences));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notification-preferences', 'u1'] }));
  });
});
