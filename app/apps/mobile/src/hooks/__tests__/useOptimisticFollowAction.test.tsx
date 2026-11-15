import type { User } from '@kc/domain';
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../services/followComposition', () => Object.fromEntries(['getFollowUserUseCase','getUnfollowUserUseCase','getSendFollowRequestUseCase','getCancelFollowRequestUseCase'].map(k => [k, () => ({ execute: mocks.execute })])));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
import { useOptimisticFollowAction } from '../useOptimisticFollowAction';
import { FollowError } from '@kc/application';
const target = { userId: 'target', privacyMode: 'Private' as const, followersCount: 2 } as unknown as User;
describe('useOptimisticFollowAction', () => {
  let client: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  beforeEach(() => { vi.clearAllMocks(); client = new QueryClient(); });
  it('optimistically follows, adjusts counters and invalidates dependent caches on success', async () => {
    mocks.execute.mockResolvedValue(undefined);
    client.setQueryData(['follow-state','viewer','target'], { state: 'not_following_private_no_request' });
    client.setQueryData(['profile-other','handle'], { ...target });
    client.setQueryData(['user-profile','viewer'], { followingCount: 4 });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useOptimisticFollowAction({ viewerId: 'viewer', target, handle: 'handle' }), { wrapper });
    await act(async () => result.current('follow'));
    expect(client.getQueryData(['follow-state','viewer','target'])).toEqual({ state: 'following' });
    expect(client.getQueryData(['profile-other','handle'])).toMatchObject({ followersCount: 3 });
    expect(client.getQueryData(['user-profile','viewer'])).toMatchObject({ followingCount: 5 });
    expect(mocks.execute).toHaveBeenCalledWith({ viewerId: 'viewer', targetUserId: 'target' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['followers','target'] });
  });
  it('rolls back caches and reports a localized failure', async () => {
    mocks.execute.mockRejectedValue(new Error('offline'));
    const oldState = { state: 'not_following_private_no_request' };
    client.setQueryData(['follow-state','viewer','target'], oldState);
    const onError = vi.fn();
    const { result } = renderHook(() => useOptimisticFollowAction({ viewerId: 'viewer', target, handle: 'handle', onError }), { wrapper });
    await act(async () => result.current('send'));
    expect(client.getQueryData(['follow-state','viewer','target'])).toEqual(oldState);
    expect(onError).toHaveBeenCalledWith({ title: 'profile.followErrorTitle', message: 'profile.followErrorMessage' });
  });
  it('uses the private no-request state on cancel and does not change counters', async () => {
    mocks.execute.mockResolvedValue(undefined);
    client.setQueryData(['profile-other','handle'], { ...target });
    const { result } = renderHook(() => useOptimisticFollowAction({ viewerId: 'viewer', target, handle: 'handle' }), { wrapper });
    await act(async () => result.current('cancel'));
    expect(client.getQueryData(['follow-state','viewer','target'])).toEqual({ state: 'not_following_private_no_request' });
    expect(client.getQueryData(['profile-other','handle'])).toEqual(target);
  });
  it('does nothing for a guest viewer', async () => {
    const { result } = renderHook(() => useOptimisticFollowAction({ viewerId: undefined, target, handle: 'handle' }), { wrapper });
    await act(async () => result.current('follow'));
    expect(mocks.execute).not.toHaveBeenCalled(); expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
  it('unfollows a public target with a zero-clamped counter delta and invalidates every dependent key', async () => {
    mocks.execute.mockResolvedValue(undefined);
    client.setQueryData(['follow-state','viewer','target'], { state: 'following' });
    client.setQueryData(['profile-other','handle'], { ...target, privacyMode: 'Public', followersCount: 0 });
    client.setQueryData(['user-profile','viewer'], { followingCount: 1 });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useOptimisticFollowAction({ viewerId: 'viewer', target: { ...target, privacyMode: 'Public' }, handle: 'handle' }), { wrapper });
    await act(async () => result.current('unfollow'));
    expect(mocks.execute).toHaveBeenCalledWith({ viewerId: 'viewer', targetUserId: 'target' });
    expect(client.getQueryData(['follow-state','viewer','target'])).toEqual({ state: 'not_following_public' });
    expect(client.getQueryData(['profile-other','handle'])).toMatchObject({ followersCount: 0 });
    expect(client.getQueryData(['user-profile','viewer'])).toMatchObject({ followingCount: 0 });
    for (const queryKey of [['follow-state','viewer','target'], ['profile-other','handle'], ['user-profile','viewer'], ['following','viewer'], ['followers','target']]) expect(invalidate).toHaveBeenCalledWith({ queryKey });
  });
  it('sends requests without changing counts and maps cooldown failures to the calculated day count', async () => {
    const cooldownUntil = new Date(Date.now() + 2 * 86400000).toISOString();
    mocks.execute.mockRejectedValue(new FollowError('cooldown_active', 'wait', { cooldownUntil }));
    const priorState = { state: 'not_following_private_no_request' };
    client.setQueryData(['follow-state','viewer','target'], priorState);
    client.setQueryData(['profile-other','handle'], { ...target }); client.setQueryData(['user-profile','viewer'], { followingCount: 8 });
    const onError = vi.fn(); const { result } = renderHook(() => useOptimisticFollowAction({ viewerId: 'viewer', target, handle: 'handle', onError }), { wrapper });
    await act(async () => result.current('send'));
    expect(client.getQueryData(['follow-state','viewer','target'])).toEqual(priorState);
    expect(client.getQueryData(['profile-other','handle'])).toEqual(target);
    expect(client.getQueryData(['user-profile','viewer'])).toMatchObject({ followingCount: 8 });
    expect(onError).toHaveBeenCalledWith({ title: 'profile.followCooldownTitle', message: 'profile.followCooldownDays' });
  });
  it.each([
    ['rate_limited', 'profile.followRateLimited'],
    ['account_not_active', 'profile.followAccountNotActive'],
  ] as const)('explains the server refusal %s with its own message', async (code, message) => {
    mocks.execute.mockRejectedValue(new FollowError(code, code));
    const onError = vi.fn(); const { result } = renderHook(() => useOptimisticFollowAction({ viewerId: 'viewer', target, handle: 'handle', onError }), { wrapper });
    await act(async () => result.current('follow'));
    expect(onError).toHaveBeenCalledWith({ title: 'profile.followErrorTitle', message });
  });
});
