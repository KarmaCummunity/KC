// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../services/postsComposition', () => ({ getActivePostsCountUseCase: () => ({ execute }) }));
import { useActivePostsCount } from '../useActivePostsCount';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); vi.clearAllMocks(); });

describe('useActivePostsCount', () => {
  it('returns the fetched numeric count', async () => {
    execute.mockResolvedValue(42);
    const { result } = renderHook(() => useActivePostsCount(), { wrapper });
    await waitFor(() => expect(result.current).toBe(42));
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns undefined before data and for a non-number result', async () => {
    execute.mockResolvedValue('42');
    const { result } = renderHook(() => useActivePostsCount(), { wrapper });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current).toBeUndefined());
  });
});
