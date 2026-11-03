// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { get, set } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('../../lib/container', () => ({ container: { activeStatus: { get, set } } }));
import { activeStatusQueryKey, useActiveStatusSetting } from '../useActiveStatusSetting';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); get.mockResolvedValue(true); set.mockResolvedValue(false); });
afterEach(() => { cleanup(); client.clear(); vi.clearAllMocks(); });

describe('useActiveStatusSetting', () => {
  it('loads the setting for an authenticated user and stores the successful value', async () => {
    const { result } = renderHook(() => useActiveStatusSetting('user-1'), { wrapper });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    act(() => result.current.setEnabled(false));
    await waitFor(() => expect(result.current.enabled).toBe(false));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(set).toHaveBeenCalledWith(false);
    expect(client.getQueryData(activeStatusQueryKey('user-1'))).toBe(false);
  });

  it('does not fetch without a user id', () => {
    const { result } = renderHook(() => useActiveStatusSetting(null), { wrapper });
    expect(result.current.enabled).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it('rolls back the optimistic value when saving rejects', async () => {
    set.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useActiveStatusSetting('user-2'), { wrapper });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    act(() => result.current.setEnabled(false));
    await waitFor(() => expect(result.current.saving).toBe(false));
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(set).toHaveBeenCalledWith(false);
  });
});
