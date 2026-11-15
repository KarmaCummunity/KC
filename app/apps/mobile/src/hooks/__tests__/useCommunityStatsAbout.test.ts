// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../services/postsComposition', () => ({ getCommunityStatsSnapshotUseCase: () => ({ execute: mocks.execute }) }));

import { COMMUNITY_STATS_REFRESH_MS, useCommunityStatsAbout } from '../useCommunityStatsAbout';

const snapshot = { registeredUsers: 12, activePublicPosts: 7, itemsDeliveredTotal: 31, asOf: '2026-01-01T00:00:00Z' };

beforeEach(() => {
  mocks.execute.mockResolvedValue(snapshot);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useCommunityStatsAbout', () => {
  it('loads the initial snapshot', async () => {
    const { result } = renderHook(() => useCommunityStatsAbout());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ users: 12, posts: 7, delivered: 31, error: false });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('marks errors and recovers through refetch', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(snapshot);
    const { result } = renderHook(() => useCommunityStatsAbout());
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, error: true }));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current).toMatchObject({ users: 12, posts: 7, delivered: 31, loading: false, error: false }));
  });

  it('reads the counters again every minute and stops when the screen closes', async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useCommunityStatsAbout());
    await act(async () => {});
    expect(mocks.execute).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMMUNITY_STATS_REFRESH_MS);
    });
    expect(mocks.execute).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMMUNITY_STATS_REFRESH_MS * 3);
    });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it('ignores an in-flight snapshot after unmount', async () => {
    let resolveSnapshot: ((value: typeof snapshot) => void) | undefined;
    mocks.execute.mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    const { result, unmount } = renderHook(() => useCommunityStatsAbout());
    await waitFor(() => expect(resolveSnapshot).toBeDefined());
    unmount();
    await act(async () => resolveSnapshot?.(snapshot));
    expect(result.current).toMatchObject({ users: 0, posts: 0, delivered: 0, loading: true, error: false });
  });
});
