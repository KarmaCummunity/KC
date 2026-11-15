import { describe, it, expect, vi } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Capture the handler the installer registers with expo-notifications.
let capturedHandler:
  | ((n: { request: { content: { data: unknown } } }) => Promise<unknown>)
  | null = null;
const setHandlerSpy = vi.fn();

vi.mock('expo-notifications', () => ({
  setNotificationHandler: (cfg: any) => {
    setHandlerSpy(cfg);
    capturedHandler = cfg.handleNotification;
  },
}));

import { useActiveScreenStore } from '../useActiveScreenStore';
import { installForegroundHandler } from '../foregroundHandler';

// installForegroundHandler is idempotent at module scope; the first call in
// this file registers the handler, and we read it through `capturedHandler`.
installForegroundHandler();

async function dispatch(data: unknown) {
  return capturedHandler!({ request: { content: { data } } });
}

describe('foregroundHandler — install side effects', () => {
  it('calls Notifications.setNotificationHandler exactly once across repeated installs (idempotency)', () => {
    const before = setHandlerSpy.mock.calls.length;
    installForegroundHandler();
    installForegroundHandler();
    expect(setHandlerSpy.mock.calls.length).toBe(before); // no new calls
  });
});

describe('foregroundHandler — handleNotification', () => {
  it('suppresses banner/sound/badge/list when the user is on the exact chat thread the push targets', async () => {
    useActiveScreenStore.setState({ route: '/chat/c_1' });
    const out = await dispatch({ kind: 'chat_message', entity: { type: 'chat', id: 'c_1' } });
    expect(out).toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });

  it('shows everything when active route is the inbox (not the specific chat)', async () => {
    useActiveScreenStore.setState({ route: '/chat' });
    const out = await dispatch({ kind: 'chat_message', entity: { type: 'chat', id: 'c_1' } });
    expect(out).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    });
  });

  it('shows everything when active route is a DIFFERENT chat (c_2 vs the push for c_1)', async () => {
    useActiveScreenStore.setState({ route: '/chat/c_2' });
    const out = await dispatch({ kind: 'chat_message', entity: { type: 'chat', id: 'c_1' } });
    expect((out as { shouldShowBanner: boolean }).shouldShowBanner).toBe(true);
  });

  it('shows everything when active route is null (cold app + foreground push)', async () => {
    useActiveScreenStore.setState({ route: null });
    const out = await dispatch({ kind: 'chat_message', entity: { type: 'chat', id: 'c_1' } });
    expect((out as { shouldShowBanner: boolean }).shouldShowBanner).toBe(true);
  });

  it('shows everything when the entity is not a chat even if its id matches the route', async () => {
    useActiveScreenStore.setState({ route: '/chat/c_1' });
    const out = await dispatch({ kind: 'post_comment', entity: { type: 'post', id: 'c_1' } });
    expect((out as { shouldShowBanner: boolean }).shouldShowBanner).toBe(true);
  });

  it('shows everything when the entity is missing from the push payload (defensive)', async () => {
    useActiveScreenStore.setState({ route: '/chat/c_1' });
    const out = await dispatch({ kind: 'chat_message' });
    expect((out as { shouldShowBanner: boolean }).shouldShowBanner).toBe(true);
  });

  it('shows everything when data is completely empty (no kind, no chat_id)', async () => {
    useActiveScreenStore.setState({ route: '/chat/c_1' });
    const out = await dispatch({});
    expect((out as { shouldShowBanner: boolean }).shouldShowBanner).toBe(true);
  });
});
