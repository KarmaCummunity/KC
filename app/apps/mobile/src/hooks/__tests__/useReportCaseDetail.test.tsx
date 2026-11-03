// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../lib/container', () => ({ container: { getReportCaseDetail: { execute } } }));
import { useReportCaseDetail } from '../useReportCaseDetail';

let client: QueryClient;
function renderDetail(targetType: 'post' | null, targetId: string | null) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useReportCaseDetail(targetType, targetId), { wrapper });
}
beforeEach(() => { vi.clearAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { client.clear(); });

describe('useReportCaseDetail', () => {
  it('fetches an enabled case and uses the expected cache key and stale time', async () => {
    execute.mockResolvedValue({ caseId: 'case-1' });
    const { result } = renderDetail('post', 'p1');
    await waitFor(() => expect(result.current.data).toEqual({ caseId: 'case-1' }));
    expect(execute).toHaveBeenCalledWith('post', 'p1');
    expect(client.getQueryState(['admin.reports.case', 'post', 'p1'])?.data).toEqual({ caseId: 'case-1' });
    expect(client.getQueryState(['admin.reports.case', 'post', 'p1'])?.dataUpdatedAt).toBeGreaterThan(0);
  });

  it('does not fetch when either identifier is absent', () => {
    renderDetail(null, 'p1');
    renderDetail('post', null);
    expect(execute).not.toHaveBeenCalled();
  });

  it('exposes a rejected fetch as an error', async () => {
    execute.mockRejectedValue(new Error('offline'));
    const { result } = renderDetail('post', 'p1');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error('offline'));
  });
});
