// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), channel: { on: vi.fn(), subscribe: vi.fn() },
  supabase: { channel: vi.fn(), removeChannel: vi.fn() },
}));
vi.mock('../../services/postsComposition', () => ({ getCommunityStatsSnapshotUseCase: () => ({ execute: mocks.execute }) }));
vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => mocks.supabase }));

import { useCommunityStatsAbout } from '../useCommunityStatsAbout';

const snapshot = { registeredUsers: 12, activePublicPosts: 7, itemsDeliveredTotal: 31, asOf: '2026-01-01T00:00:00Z' };

beforeEach(() => {
  mocks.execute.mockResolvedValue(snapshot);
  mocks.channel.on.mockReturnThis();
  mocks.channel.subscribe.mockReturnValue({ topic: 'community-stats-channel' });
  mocks.supabase.channel.mockReturnValue(mocks.channel);
  mocks.supabase.removeChannel.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe('useCommunityStatsAbout', () => {
  it('loads the initial snapshot and subscribes to community stats changes', async () => {
    const { result } = renderHook(() => useCommunityStatsAbout());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ users: 12, posts: 7, delivered: 31, error: false });
    expect(mocks.supabase.channel).toHaveBeenCalledWith(expect.stringMatching(/^community-stats-watch:/));
    expect(mocks.channel.on).toHaveBeenCalledWith('postgres_changes', {
      event: '*', schema: 'public', table: 'community_stats',
    }, expect.any(Function));
    expect(mocks.channel.subscribe).toHaveBeenCalledTimes(1);
  });

  it('marks errors and recovers through refetch', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(snapshot);
    const { result } = renderHook(() => useCommunityStatsAbout());
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, error: true }));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current).toMatchObject({ users: 12, posts: 7, delivered: 31, loading: false, error: false }));
  });

  it('refetches on realtime events and removes the subscribed channel on unmount', async () => {
    const { unmount } = renderHook(() => useCommunityStatsAbout());
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
    const callback = mocks.channel.on.mock.calls[0]?.[2] as (() => void) | undefined;
    expect(callback).toBeDefined();
    act(() => callback?.());
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    unmount();
    expect(mocks.supabase.removeChannel).toHaveBeenCalledWith({ topic: 'community-stats-channel' });
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
