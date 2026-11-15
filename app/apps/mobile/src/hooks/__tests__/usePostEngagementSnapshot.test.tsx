// @vitest-environment jsdom
// Likes and comments of a post as a cached snapshot: a reopened post paints from the cache and
// refreshes behind it; optimistic patches move the counters with the tap (NFR-PERF-005).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const repo = vi.hoisted(() => ({ getStats: vi.fn(), listCommentsWithAuthors: vi.fn(), getViewerReaction: vi.fn() }));
vi.mock('../../lib/container', () => ({ container: { postEngagement: repo } }));

import {
  postEngagementQueryKey,
  usePostEngagementSnapshot,
  withCommentLike,
  withReaction,
  type PostEngagementSnapshot,
} from '../usePostEngagementSnapshot';

const COMMENT = { commentId: 'c1', likeCount: 2, likedByViewer: false } as PostEngagementSnapshot['comments'][number];
const SNAPSHOT: PostEngagementSnapshot = {
  stats: { reactionCount: 3, commentCount: 1 },
  activeReaction: null,
  comments: [COMMENT],
  commentsFailed: false,
};

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  repo.getStats.mockResolvedValue({ reactionCount: 3, commentCount: 1 });
  repo.listCommentsWithAuthors.mockResolvedValue([COMMENT]);
  repo.getViewerReaction.mockResolvedValue('like');
});

describe('usePostEngagementSnapshot', () => {
  it('reads the stats, the thread and the viewer reaction into one snapshot', async () => {
    const { result } = renderHook(() => usePostEngagementSnapshot('p1', 'u1'), { wrapper });
    expect(result.current.loaded).toBe(false);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.snapshot).toEqual({ ...SNAPSHOT, activeReaction: 'like' });
    expect(repo.listCommentsWithAuthors).toHaveBeenCalledWith('p1', 120);
  });

  it('paints a reopened post from the cache at once, then refreshes it', async () => {
    client.setQueryData(postEngagementQueryKey('p1', 'u1'), SNAPSHOT);
    const { result } = renderHook(() => usePostEngagementSnapshot('p1', 'u1'), { wrapper });
    expect(result.current.loaded).toBe(true);
    expect(result.current.snapshot.comments).toEqual([COMMENT]);
    await waitFor(() => expect(result.current.snapshot.activeReaction).toBe('like'));
  });

  it('keeps the previous thread and flags the failure when the comments read fails', async () => {
    client.setQueryData(postEngagementQueryKey('p1', 'u1'), SNAPSHOT);
    repo.listCommentsWithAuthors.mockRejectedValue(new Error('offline'));
    repo.getStats.mockResolvedValue({ reactionCount: 9, commentCount: 1 });
    const { result } = renderHook(() => usePostEngagementSnapshot('p1', 'u1'), { wrapper });
    await waitFor(() => expect(result.current.snapshot.commentsFailed).toBe(true));
    expect(result.current.snapshot.comments).toEqual([COMMENT]);
    expect(result.current.snapshot.stats.reactionCount).toBe(9);
  });

  it('reads only the stats for a guest', async () => {
    const { result } = renderHook(() => usePostEngagementSnapshot('p1', null), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(repo.listCommentsWithAuthors).not.toHaveBeenCalled();
    expect(result.current.snapshot.commentsFailed).toBe(false);
  });

  it('patches the cached snapshot and restores the one it replaced', async () => {
    const { result } = renderHook(() => usePostEngagementSnapshot('p1', 'u1'), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let previous: PostEngagementSnapshot | undefined;
    act(() => { previous = result.current.patch((s) => withReaction(s, null)); });
    // The cache notifies its observers on the next tick.
    await waitFor(() => expect(result.current.snapshot.activeReaction).toBeNull());
    expect(result.current.snapshot.stats.reactionCount).toBe(2);
    expect(previous?.activeReaction).toBe('like');
    act(() => { result.current.restore(previous as PostEngagementSnapshot); });
    await waitFor(() => expect(result.current.snapshot.activeReaction).toBe('like'));
  });
});

describe('optimistic snapshot patches', () => {
  it('moves the reaction counter with the first reaction, a switch and a removal', () => {
    const liked = withReaction(SNAPSHOT, 'like' as never);
    expect(liked.stats.reactionCount).toBe(4);
    expect(withReaction(liked, 'love' as never).stats.reactionCount).toBe(4);
    expect(withReaction(liked, null).stats.reactionCount).toBe(3);
  });

  it('never drops a counter below zero', () => {
    const empty = { ...SNAPSHOT, stats: { reactionCount: 0, commentCount: 0 }, activeReaction: 'like' as never };
    expect(withReaction(empty, null).stats.reactionCount).toBe(0);
  });

  it('likes and unlikes one comment, and leaves an unchanged like alone', () => {
    const liked = withCommentLike(SNAPSHOT, 'c1', true);
    expect(liked.comments[0]).toMatchObject({ likedByViewer: true, likeCount: 3 });
    expect(withCommentLike(liked, 'c1', true).comments[0]).toBe(liked.comments[0]);
    expect(withCommentLike(liked, 'c1', false).comments[0]).toMatchObject({ likedByViewer: false, likeCount: 2 });
    expect(withCommentLike(SNAPSHOT, 'other', true).comments[0]).toBe(COMMENT);
  });
});
