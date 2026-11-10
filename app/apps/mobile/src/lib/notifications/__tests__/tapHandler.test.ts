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
    responseHandler?.(response({ kind: 'chat_message', chat_id: '11111111-1111-4111-8111-111111111111' }));
    responseHandler?.(response({ kind: 'unknown', route: '/arbitrary' }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: '11111111-1111-4111-8111-111111111111' } });
  });
  it('captures and later flushes a restorable cold-start tap after auth settles', async () => {
    auth.isAuthenticated = false;
    lastResponse.mockResolvedValue(response({ kind: 'chat_message', chat_id: '11111111-1111-4111-8111-111111111111' }));
    renderHook(() => useNotificationTapRouting());
    await vi.waitFor(() => expect(capturePath).toHaveBeenCalled());
    expect(capturePath).toHaveBeenCalledWith('/chat/11111111-1111-4111-8111-111111111111');
    expect(push).not.toHaveBeenCalled();
    const authListener = subscribe.mock.calls[0][0];
    authListener({ isAuthenticated: true, isLoading: false, onboardingState: 'completed' });
    expect(push).toHaveBeenCalledTimes(1);
  });
  it('routes every supported notification kind to its exact allow-listed destination', () => {
    renderHook(() => useNotificationTapRouting());
    const id = '11111111-1111-4111-8111-111111111111';
    const routes: Array<[string, object, string, object]> = [
      ...['chat_message','support_message','system_message'].map(k => [k, { chat_id: id }, '/chat/[id]', { id }] as [string, object, string, object]),
      ...['post_expiring','post_relevance_check','mark_recipient','unmark_recipient'].map(k => [k, { params: { id } }, '/post/[id]', { id }] as [string, object, string, object]),
      ...['auto_removed'].map(k => [k, {}, '/settings/audit', {}] as [string, object, string, object]),
      ...['follow_request','follow_started','follow_approved'].map(k => [k, {}, '/settings/follow-requests', {}] as [string, object, string, object]),
      ['task_assigned', { params: { task_id: id } }, '/(admin)/tasks/[taskId]', { taskId: id }],
      ...['ride_request','ride_approved','ride_rejected','ride_participant_cancelled','ride_participant_cancelled_by_owner','ride_started','ride_arrived','ride_breakdown','ride_emergency'].map(k => [k, { params: { id } }, '/(tabs)/donations/rides/[id]', { id }] as [string, object, string, object]),
      ['ride_rate_prompt', { params: { id } }, '/(tabs)/donations/rides/[id]/rate', { id }],
      ...['match_suggested','match_interest','match_accepted'].map(k => [k, {}, '/matches', {}] as [string, object, string, object]),
      ...['listing_expiring','listing_expired','ride_booking_requested','ride_booking_confirmed','ride_booking_declined','ride_booking_expired','ride_booking_cancelled','ride_route_match','ride_listing_emergency','giving_handoff_requested','giving_handoff_claimed','giving_handoff_confirmed','giving_handoff_declined','giving_handoff_cancelled','giving_handoff_expired','giving_handoff_completed'].map(k => [k, { params: { listingId: id } }, '/listing/[listingId]', { listingId: id }] as [string, object, string, object]),
    ];
    routes.forEach(([kind, payload, _pathname, _params]) => responseHandler?.(response({ kind, ...payload })));
    expect(push).toHaveBeenCalledTimes(routes.length);
    routes.forEach(([, , pathname, params], i) => expect(push).toHaveBeenNthCalledWith(i + 1, { pathname, params }));
  });
  it('drops malformed ids, unknown kinds, attacker routes, and handles the safe task fallback', () => {
    renderHook(() => useNotificationTapRouting());
    responseHandler?.(response({ kind: 'chat_message', chat_id: 'not-a-uuid' }));
    responseHandler?.(response({ kind: 'post_expiring', params: {} }));
    responseHandler?.(response({ kind: 'listing_expired', params: { listingId: 'bad' } }));
    responseHandler?.(response({ kind: 'unknown', route: '/account-blocked' }));
    responseHandler?.(response({ kind: 'task_assigned', params: { task_id: 'bad' } }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({ pathname: '/(admin)/tasks', params: {} });
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
  it('accepts supported fallback id fields and drops absent or non-object payloads safely', () => {
    renderHook(() => useNotificationTapRouting());
    responseHandler?.(response({ kind: 'chat_message', params: { id: '11111111-1111-4111-8111-111111111111' } }));
    responseHandler?.(response({ kind: 'ride_request', params: {} }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: '11111111-1111-4111-8111-111111111111' } });
    expect(() => responseHandler?.(response(null))).not.toThrow();
  });
});
