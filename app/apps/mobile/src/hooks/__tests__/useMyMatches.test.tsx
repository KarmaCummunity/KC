// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, listMine, respond } = vi.hoisted(() => ({
  auth: { userId: 'u1' as string | null }, listMine: vi.fn(), respond: vi.fn(),
}));
vi.mock('../../store/authStore', () => ({ useAuthStore: (selector: (state: { session: { userId: string } | null }) => unknown) => selector({ session: auth.userId ? { userId: auth.userId } : null }) }));
vi.mock('../../services/matchingComposition', () => ({ getMatchRepository: () => ({ listMine, respond }) }));
import { myMatchesQueryKey, useMyMatches, useRespondToMatch } from '../useMyMatches';
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => { auth.userId = 'u1'; client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); vi.clearAllMocks(); });
afterEach(cleanup);

describe('useMyMatches', () => {
  it('loads with the selected limit and exposes a failed list query', async () => {
    listMine.mockResolvedValue([{ candidateId: 'c1' }]);
    const { result } = renderHook(() => useMyMatches(7), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ candidateId: 'c1' }]));
    expect(listMine).toHaveBeenCalledWith(7);
    listMine.mockRejectedValue(new Error('offline'));
    const failed = renderHook(() => useMyMatches(8), { wrapper });
    await waitFor(() => expect(failed.result.current.isError).toBe(true));
  });

  it('disables listing when signed out and responds with exact args then invalidates the user key', async () => {
    auth.userId = null;
    const signedOut = renderHook(() => useMyMatches(), { wrapper });
    expect(signedOut.result.current.fetchStatus).toBe('idle');
    expect(listMine).not.toHaveBeenCalled();
    auth.userId = 'u2';
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    respond.mockResolvedValue({ accepted: true });
    const mutation = renderHook(() => useRespondToMatch(), { wrapper });
    await act(async () => { await mutation.result.current.mutateAsync({ candidateId: 'c9', response: 'accept' }); });
    expect(respond).toHaveBeenCalledWith('c9', 'accept');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: myMatchesQueryKey('u2') });
    respond.mockRejectedValue(new Error('response failed'));
    await act(async () => { await expect(mutation.result.current.mutateAsync({ candidateId: 'c10', response: 'decline' })).rejects.toThrow('response failed'); });
    expect(mutation.result.current.isError).toBe(true);
  });
});
