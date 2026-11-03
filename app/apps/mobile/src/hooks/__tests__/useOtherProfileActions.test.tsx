// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { User } from '@kc/domain';
const { push, openChat, consume } = vi.hoisted(() => ({ push: vi.fn(), openChat: vi.fn(), consume: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('../../lib/container', () => ({ container: { openOrCreateChat: { execute: openChat } } }));
vi.mock('../../lib/chatNavigationPrefs', () => ({ consumePreferNewThread: consume }));
import { useOtherProfileActions } from '../useOtherProfileActions';
const target = { userId: 'u2' } as unknown as User;
beforeEach(() => { vi.clearAllMocks(); openChat.mockResolvedValue({ chatId: 'c1' }); consume.mockReturnValue(true); });
describe('useOtherProfileActions', () => {
 it('maps every follow state to its dispatch action', () => { const dispatch = vi.fn(); const { result } = renderHook(() => useOtherProfileActions({ me: 'u1', target, dispatchFollowAction: dispatch })); for (const state of ['not_following_public', 'following', 'not_following_private_no_request', 'request_pending'] as const) act(() => result.current.onFollowPress(state)); act(() => result.current.onFollowPress(undefined)); expect(dispatch.mock.calls).toEqual([['follow'], ['unfollow'], ['send'], ['cancel']]); });
 it('opens or creates a chat using consumed preference and routes to it', async () => { const { result } = renderHook(() => useOtherProfileActions({ me: 'u1', target, dispatchFollowAction: vi.fn() })); await act(async () => { await result.current.startChat(); }); expect(consume).toHaveBeenCalledWith('u2'); expect(openChat).toHaveBeenCalledWith({ viewerId: 'u1', otherUserId: 'u2', preferNewThread: true }); expect(push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'c1' } }); });
 it('guards missing viewer or target and propagates repository rejection', async () => { const { result, rerender } = renderHook((props: { me: string | undefined; target: User | null }) => useOtherProfileActions({ ...props, dispatchFollowAction: vi.fn() }), { initialProps: { me: undefined as string | undefined, target: target as User | null } }); await act(async () => { await result.current.startChat(); }); rerender({ me: 'u1', target: null }); await act(async () => { await result.current.startChat(); }); expect(openChat).not.toHaveBeenCalled(); openChat.mockRejectedValue(new Error('offline')); rerender({ me: 'u1', target }); await expect(result.current.startChat()).rejects.toThrow('offline'); expect(push).not.toHaveBeenCalled(); });
});
