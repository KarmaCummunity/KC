// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../lib/container', () => ({ container: { setManager: { execute } } }));
import { useSetManager } from '../useSetManager';

const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
function renderManager() {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useSetManager(), { wrapper });
}
beforeEach(() => { vi.clearAllMocks(); client.clear(); });

describe('useSetManager', () => {
  it('assigns the manager and invalidates the organization tree on success', async () => {
    execute.mockResolvedValue(undefined);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderManager();
    await act(() => result.current.mutateAsync({ grantId: 'g1', managerGrantId: 'g2' }));
    expect(execute).toHaveBeenCalledWith({ grantId: 'g1', managerGrantId: 'g2' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin.org.tree'] });
  });

  it('supports clearing a manager and preserves mutation errors without invalidating', async () => {
    execute.mockResolvedValueOnce(undefined);
    const { result } = renderManager();
    await act(() => result.current.mutateAsync({ grantId: 'g1', managerGrantId: null }));
    expect(execute).toHaveBeenCalledWith({ grantId: 'g1', managerGrantId: null });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    invalidate.mockClear();
    execute.mockRejectedValue(new Error('offline'));
    await act(async () => {
      await expect(result.current.mutateAsync({ grantId: 'g1', managerGrantId: 'g3' })).rejects.toThrow('offline');
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
