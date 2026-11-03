// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

const { countProfileOpenPosts, countProfileClosedPosts } = vi.hoisted(() => ({
  countProfileOpenPosts: vi.fn(), countProfileClosedPosts: vi.fn(),
}));
vi.mock('../../services/postsComposition', () => ({
  getPostRepo: () => ({ countProfileOpenPosts, countProfileClosedPosts }),
}));
import { useProfileTabCounts } from '../useProfileTabCounts';

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  countProfileOpenPosts.mockReset();
  countProfileClosedPosts.mockReset();
});
afterEach(() => client.clear());

describe('useProfileTabCounts', () => {
  it('returns both counts and their total for self, excluding only-me posts', async () => {
    countProfileOpenPosts.mockResolvedValue(4);
    countProfileClosedPosts.mockResolvedValue(3);
    const { result } = renderHook(() => useProfileTabCounts({
      profileUserId: 'same', viewerUserId: 'same',
    }), { wrapper });
    await waitFor(() => expect(result.current.totalCount).toBe(7));
    expect(countProfileOpenPosts).toHaveBeenCalledWith('same', { excludeOnlyMe: true });
    expect(countProfileClosedPosts).toHaveBeenCalledWith('same', 'same');
    expect(result.current.isLoading).toBe(false);
  });

  it('includes only-me posts for another viewer and leaves total undefined until both counts arrive', async () => {
    countProfileOpenPosts.mockResolvedValue(2);
    let finishClosed: ((value: number) => void) | undefined;
    countProfileClosedPosts.mockImplementation(() => new Promise<number>((resolve) => { finishClosed = resolve; }));
    const { result } = renderHook(() => useProfileTabCounts({
      profileUserId: 'owner', viewerUserId: 'viewer',
    }), { wrapper });
    expect(countProfileOpenPosts).toHaveBeenCalledWith('owner', { excludeOnlyMe: false });
    await waitFor(() => expect(result.current.openCount).toBe(2));
    expect(result.current.totalCount).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
    finishClosed?.(1);
    await waitFor(() => expect(result.current.totalCount).toBe(3));
  });

  it('does not query without an id or when disabled, and tolerates a failed count', async () => {
    const missing = renderHook(() => useProfileTabCounts({ profileUserId: undefined, viewerUserId: null }), { wrapper });
    const disabled = renderHook(() => useProfileTabCounts({ profileUserId: 'owner', viewerUserId: null, enabled: false }), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(countProfileOpenPosts).not.toHaveBeenCalled();
    expect(countProfileClosedPosts).not.toHaveBeenCalled();
    expect(missing.result.current.totalCount).toBeUndefined();
    expect(disabled.result.current.totalCount).toBeUndefined();

    countProfileOpenPosts.mockRejectedValue(new Error('offline'));
    countProfileClosedPosts.mockResolvedValue(2);
    const failed = renderHook(() => useProfileTabCounts({ profileUserId: 'other', viewerUserId: null }), { wrapper });
    await waitFor(() => expect(failed.result.current.isLoading).toBe(false));
    expect(failed.result.current.openCount).toBeUndefined();
    expect(failed.result.current.closedCount).toBe(2);
    expect(failed.result.current.totalCount).toBeUndefined();
  });
});
