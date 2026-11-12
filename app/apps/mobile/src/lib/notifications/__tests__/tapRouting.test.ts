import { describe, it, expect } from 'vitest';
import type { PushData } from '@kc/domain';
import {
  decideTapAction,
  isReadyToRoute,
  toConcretePath,
  type TapAuthState,
} from '../tapRouting';

const UUID = '11111111-1111-4111-8111-111111111111';

const READY: TapAuthState = { isAuthenticated: true, isLoading: false, onboardingState: 'completed' };
const SIGNED_OUT: TapAuthState = { isAuthenticated: false, isLoading: false, onboardingState: null };
const RESTORING: TapAuthState = { isAuthenticated: false, isLoading: true, onboardingState: null };
const MID_ONBOARDING: TapAuthState = {
  isAuthenticated: true,
  isLoading: false,
  onboardingState: 'pending_avatar',
};

const chatTap: Partial<PushData> = {
  category: 'social',
  kind: 'chat_message',
  notification_id: 'n1',
  entity: { type: 'chat', id: UUID },
};

describe('isReadyToRoute', () => {
  it('is true only when authenticated, settled, and onboarding completed', () => {
    expect(isReadyToRoute(READY)).toBe(true);
    expect(isReadyToRoute(SIGNED_OUT)).toBe(false);
    expect(isReadyToRoute(RESTORING)).toBe(false);
    expect(isReadyToRoute(MID_ONBOARDING)).toBe(false);
  });
});

describe('toConcretePath', () => {
  it('expands [param] templates with their values', () => {
    expect(toConcretePath({ pathname: '/chat/[id]', params: { id: UUID } })).toBe(`/chat/${UUID}`);
    expect(toConcretePath({ pathname: '/post/[id]', params: { id: UUID } })).toBe(`/post/${UUID}`);
  });

  it('leaves param-free paths unchanged', () => {
    expect(toConcretePath({ pathname: '/settings/audit', params: {} })).toBe('/settings/audit');
  });
});

describe('decideTapAction', () => {
  it('drops a payload that is not a notification', () => {
    expect(decideTapAction({} as Partial<PushData>, READY)).toEqual({ kind: 'drop' });
    expect(decideTapAction({ kind: 7 } as unknown as Partial<PushData>, READY)).toEqual({ kind: 'drop' });
  });

  it('opens the notification centre for an unknown kind or a malformed id', () => {
    const inbox = { kind: 'push', route: { pathname: '/notifications/inbox', params: {} } };
    expect(decideTapAction({ kind: 'nope' } as unknown as Partial<PushData>, READY)).toEqual(inbox);
    expect(
      decideTapAction({ kind: 'chat_message', entity: { type: 'chat', id: 'not-a-uuid' } }, READY),
    ).toEqual(inbox);
  });

  it('pushes immediately when the app is ready', () => {
    expect(decideTapAction(chatTap, READY)).toEqual({
      kind: 'push',
      route: { pathname: '/chat/[id]', params: { id: UUID } },
    });
  });

  it('defers a restorable target on cold start with the concrete restorePath', () => {
    expect(decideTapAction(chatTap, SIGNED_OUT)).toEqual({
      kind: 'defer',
      route: { pathname: '/chat/[id]', params: { id: UUID } },
      restorePath: `/chat/${UUID}`,
    });
  });

  it('defers while the session is still restoring (isLoading)', () => {
    expect(decideTapAction(chatTap, RESTORING).kind).toBe('defer');
  });

  it('defers a non-restorable target (settings/admin/rides) with restorePath = null', () => {
    const followTap: Partial<PushData> = {
      category: 'social',
      kind: 'follow_request',
      notification_id: 'n2',
    };
    expect(decideTapAction(followTap, SIGNED_OUT)).toEqual({
      kind: 'defer',
      route: { pathname: '/settings/follow-requests', params: {} },
      restorePath: null,
    });
  });
});
