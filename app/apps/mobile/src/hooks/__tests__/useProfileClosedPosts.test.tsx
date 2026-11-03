// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../services/postsComposition', () => ({
  getProfileClosedPostsUseCase: () => ({ execute }),
}));
import { useProfileClosedPosts } from '../useProfileClosedPosts';

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  execute.mockReset();
});
afterEach(() => client.clear());

describe('useProfileClosedPosts', () => {
  it('loads and flattens the standard closed-post pages, then fetches the next cursor', async () => {
    execute.mockResolvedValueOnce({ items: [{ postId: 'p1' }], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [{ postId: 'p2' }], nextCursor: null });
    const { result } = renderHook(() => useProfileClosedPosts({
      profileUserId: 'profile-1', viewerUserId: 'viewer-1',
    }), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(execute).toHaveBeenCalledWith({
      profileUserId: 'profile-1', viewerUserId: 'viewer-1', limit: 30,
      cursor: undefined, listMode: 'standard',
    });
    await result.current.loadMore();
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(execute).toHaveBeenLastCalledWith({
      profileUserId: 'profile-1', viewerUserId: 'viewer-1', limit: 30,
      cursor: 'cursor-2', listMode: 'standard',
    });
    expect(result.current.hasMore).toBe(false);
  });

  it('uses owner-only mode, honors disabled and missing-id guards', async () => {
    const hidden = renderHook(() => useProfileClosedPosts({
      profileUserId: 'owner', viewerUserId: 'owner', listMode: 'owner_only_me',
    }), { wrapper });
    await waitFor(() => expect(execute).toHaveBeenCalled());
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ listMode: 'owner_only_me' }));
    execute.mockClear();
    const disabled = renderHook(() => useProfileClosedPosts({
      profileUserId: 'owner', viewerUserId: null, enabled: false,
    }), { wrapper });
    renderHook(() => useProfileClosedPosts({ profileUserId: undefined, viewerUserId: null }), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(execute).not.toHaveBeenCalled();
    expect(hidden.result.current.items).toEqual([]);
    expect(disabled.result.current.isLoading).toBe(false);
  });

  it('surfaces query failure as an empty, not loading result', async () => {
    execute.mockRejectedValue(new Error('request failed'));
    const { result } = renderHook(() => useProfileClosedPosts({
      profileUserId: 'profile', viewerUserId: null,
    }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });
});
