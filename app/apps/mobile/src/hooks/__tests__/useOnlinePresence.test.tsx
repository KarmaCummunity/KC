// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
const { user, presence, active, listeners } = vi.hoisted(() => ({ user: { id: 'u1' as string | null }, presence: { start: vi.fn(), stop: vi.fn(), subscribe: vi.fn(), isOnline: vi.fn() }, active: { currentState: 'active', addEventListener: vi.fn() }, listeners: new Set<() => void>() }));
vi.mock('../../store/authStore', () => ({ useAuthStore: (sel: (s: { session: { userId: string } | null }) => unknown) => sel({ session: user.id ? { userId: user.id } : null }) }));
vi.mock('../../lib/container', () => ({ container: { onlinePresence: presence } }));
vi.mock('../../hooks/useActiveStatusSetting', () => ({ useActiveStatusSetting: () => ({ enabled: user.id === 'u1' }) }));
vi.mock('react-native', () => ({ AppState: active }));
import { useIsOnline, useOnlinePresenceLifecycle } from '../useOnlinePresence';
beforeEach(() => { vi.clearAllMocks(); user.id = 'u1'; active.currentState = 'active'; presence.subscribe.mockImplementation((cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); }); presence.isOnline.mockReturnValue(true); active.addEventListener.mockImplementation((_event: string, cb: (s: string) => void) => ({ remove: vi.fn(() => listeners.delete(cb as unknown as () => void)), callback: cb })); });
describe('useOnlinePresence', () => {
 it('starts when enabled, follows app state and stops on unmount', () => { const { unmount } = renderHook(() => useOnlinePresenceLifecycle()); expect(presence.start).toHaveBeenCalledWith('u1'); const sub = active.addEventListener.mock.results[0]?.value as { callback: (s: string) => void }; act(() => { sub.callback('background'); sub.callback('active'); }); expect(presence.stop).toHaveBeenCalledTimes(1); expect(presence.start).toHaveBeenCalledTimes(2); unmount(); expect(presence.stop).toHaveBeenCalledTimes(2); });
 it('stops without subscribing when signed out or app begins in background', () => { user.id = null; const first = renderHook(() => useOnlinePresenceLifecycle()); expect(presence.stop).toHaveBeenCalled(); expect(active.addEventListener).not.toHaveBeenCalled(); first.unmount(); vi.clearAllMocks(); user.id = 'u1'; active.currentState = 'background'; const second = renderHook(() => useOnlinePresenceLifecycle()); expect(presence.start).not.toHaveBeenCalled(); second.unmount(); expect(presence.stop).toHaveBeenCalled(); });
 it('reads online state and subscribes to store updates', () => { const { result, unmount } = renderHook(() => useIsOnline('u2')); expect(result.current).toBe(true); expect(presence.isOnline).toHaveBeenCalledWith('u2'); expect(presence.subscribe).toHaveBeenCalledOnce(); unmount(); });
});
