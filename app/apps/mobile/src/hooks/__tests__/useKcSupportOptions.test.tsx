// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../services/paymentsComposition', () => ({ paymentsUseCases: { kcSupportOptions: () => ({ execute }) } }));
import { useKcSupportOptions } from '../useKcSupportOptions';
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); vi.clearAllMocks(); });
afterEach(cleanup);

describe('useKcSupportOptions', () => {
  it('returns service options and uses its stable cache key', async () => {
    const options = [{ id: 'bank', label: 'Bank transfer' }];
    execute.mockResolvedValue(options);
    const { result } = renderHook(() => useKcSupportOptions(), { wrapper });
    await waitFor(() => expect(result.current.data).toBe(options));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().find({ queryKey: ['money', 'kc-support-options'] })).toBeDefined();
  });

  it('exposes a rejected service call as query error', async () => {
    const failure = new Error('unavailable');
    execute.mockRejectedValue(failure);
    const { result } = renderHook(() => useKcSupportOptions(), { wrapper });
    await waitFor(() => expect(result.current.error).toBe(failure));
  });
});
