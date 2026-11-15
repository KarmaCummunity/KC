// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { push, addListener, lastResponse, subscribe, capturePath, auth } = vi.hoisted(() => ({
  push: vi.fn(), addListener: vi.fn(), lastResponse: vi.fn(), subscribe: vi.fn(), capturePath: vi.fn(),
  auth: { isAuthenticated: true, isLoading: false, onboardingState: 'completed' as string | null },
}));
type TestResponse = { notification: { request: { content: { data: unknown } } } };
let responseHandler: ((response: TestResponse) => void) | undefined;
vi.mock('expo-router', () => ({ router: { push } }));
vi.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: (cb: (response: TestResponse) => void) => {
    responseHandler = cb; addListener(cb); return { remove: vi.fn() };
  },
  getLastNotificationResponseAsync: lastResponse,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: Object.assign(vi.fn(), { getState: vi.fn(() => auth), subscribe }),
}));
vi.mock('../../../store/redirectIntentStore', () => ({
  useRedirectIntentStore: { getState: () => ({ capturePath }) },
  isRestorablePath: (path: string) => path.startsWith('/chat/'),
}));
import { useNotificationTapRouting } from '../tapHandler';

const response = (data: unknown): TestResponse => ({ notification: { request: { content: { data } } } });
describe('useNotificationTapRouting', () => {
  beforeEach(() => { vi.clearAllMocks(); lastResponse.mockResolvedValue(null); auth.isAuthenticated = true; });
  it('routes a valid foreground tap through the allow-listed route and ignores invalid payloads', () => {
    renderHook(() => useNotificationTapRouting());
    responseHandler?.(response({ kind: 'chat_message', entity: { type: 'chat', id: '11111111-1111-4111-8111-111111111111' } }));
    responseHandler?.(response({ route: '/arbitrary' }));
    responseHandler?.(response('text'));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: '11111111-1111-4111-8111-111111111111' } });
  });
  it('captures and later flushes a restorable cold-start tap after auth settles', async () => {
    auth.isAuthenticated = false;
    lastResponse.mockResolvedValue(response({ kind: 'chat_message', entity: { type: 'chat', id: '11111111-1111-4111-8111-111111111111' } }));
    renderHook(() => useNotificationTapRouting());
    await vi.waitFor(() => expect(capturePath).toHaveBeenCalled());
    expect(capturePath).toHaveBeenCalledWith('/chat/11111111-1111-4111-8111-111111111111');
    expect(push).not.toHaveBeenCalled();
    const authListener = subscribe.mock.calls[0][0];
    authListener({ isAuthenticated: true, isLoading: false, onboardingState: 'completed' });
    expect(push).toHaveBeenCalledTimes(1);
  });
  it('never follows a path carried in the payload; a tap it cannot place opens the centre', () => {
    renderHook(() => useNotificationTapRouting());
    responseHandler?.(response({ kind: 'chat_message', entity: { type: 'chat', id: 'not-a-uuid' }, route: '/account-blocked' }));
    responseHandler?.(response({ kind: 'kind_from_a_newer_server', route: '/account-blocked', params: { id: 'x' } }));
    expect(push).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenNthCalledWith(1, { pathname: '/notifications/inbox', params: {} });
    expect(push).toHaveBeenNthCalledWith(2, { pathname: '/notifications/inbox', params: {} });
  });
  it('defers a non-restorable target without capturing an intent and flushes only when onboarding is complete', async () => {
    auth.isAuthenticated = false; lastResponse.mockResolvedValue(response({ kind: 'auto_removed' }));
    renderHook(() => useNotificationTapRouting());
    await vi.waitFor(() => expect(lastResponse).toHaveBeenCalled());
    expect(capturePath).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
    const listener = subscribe.mock.calls[0][0];
    listener({ isAuthenticated: true, isLoading: false, onboardingState: 'incomplete' });
    expect(push).not.toHaveBeenCalled();
    listener({ isAuthenticated: true, isLoading: false, onboardingState: 'completed' });
    expect(push).toHaveBeenCalledWith({ pathname: '/settings/audit', params: {} });
  });
  it('reads the post id from the arguments and survives absent payloads', () => {
    renderHook(() => useNotificationTapRouting());
    responseHandler?.(response({ kind: 'giving_handoff_confirmed', entity: { type: 'post_handoff', id: 'h' }, args: { post_id: '11111111-1111-4111-8111-111111111111' } }));
    expect(push).toHaveBeenCalledWith({ pathname: '/post/[id]', params: { id: '11111111-1111-4111-8111-111111111111' } });
    expect(() => responseHandler?.(response(null))).not.toThrow();
  });
});
