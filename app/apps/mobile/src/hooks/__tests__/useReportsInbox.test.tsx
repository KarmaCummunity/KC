// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../lib/container', () => ({ container: { listOpenReports: { execute } } }));
import { useReportsInbox } from '../useReportsInbox';

let client: QueryClient;
const filters = { targetType: 'post' } as const;
function renderInbox() {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useReportsInbox(filters), { wrapper });
}
beforeEach(() => { vi.clearAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { client.clear(); });

describe('useReportsInbox', () => {
  it('loads the first page with a null cursor and exposes the next cursor', async () => {
    const page = { items: [], nextCursor: { createdAt: '2026-01-01', targetType: 'post', targetId: 'p1' } };
    execute.mockResolvedValue(page);
    const { result } = renderInbox();
    await waitFor(() => expect(result.current.data?.pages).toEqual([page]));
    expect(execute).toHaveBeenCalledWith({ filters, cursor: null });
    expect(result.current.hasNextPage).toBe(true);
  });

  it('forwards the next cursor when fetching another page', async () => {
    const cursor = { createdAt: '2026-01-01', targetType: 'post', targetId: 'p1' };
    execute.mockResolvedValueOnce({ items: [], nextCursor: cursor }).mockResolvedValueOnce({ items: [], nextCursor: null });
    const { result } = renderInbox();
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await result.current.fetchNextPage();
    expect(execute).toHaveBeenNthCalledWith(2, { filters, cursor });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });

  it('exposes an initial page rejection', async () => {
    execute.mockRejectedValue(new Error('offline'));
    const { result } = renderInbox();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
