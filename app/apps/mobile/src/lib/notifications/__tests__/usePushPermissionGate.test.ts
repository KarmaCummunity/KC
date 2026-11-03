// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { values, getPermissionsAsync, requestPermissionsAsync } = vi.hoisted(() => ({
  values: new Map<string, string>(),
  getPermissionsAsync: vi.fn(), requestPermissionsAsync: vi.fn(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
  },
}));
vi.mock('expo-notifications', () => ({ getPermissionsAsync, requestPermissionsAsync }));
import { usePushPermissionGate } from '../usePushPermissionGate';

beforeEach(() => {
  values.clear();
  getPermissionsAsync.mockReset().mockResolvedValue({ status: 'undetermined', canAskAgain: true });
  requestPermissionsAsync.mockReset().mockResolvedValue({ status: 'granted' });
});

describe('usePushPermissionGate', () => {
  it('presents a contextual pre-prompt, accepts OS permission and persists exact state', async () => {
    const { result } = renderHook(() => usePushPermissionGate());
    await act(async () => result.current.presentPrePrompt('first-message-sent'));
    expect(result.current.modalState).toEqual({ visible: true, trigger: 'first-message-sent' });
    await act(async () => expect(await result.current.handleAccept()).toBe('granted'));
    expect(requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(result.current.modalState).toEqual({ visible: false, trigger: null });
    const saved = JSON.parse(values.get('push_permission_state') ?? '{}') as { lastPromptAt: string; lastDecision: string; osPromptShown: boolean };
    expect(saved.lastDecision).toBe('granted');
    expect(saved.osPromptShown).toBe(true);
    expect(Number.isNaN(Date.parse(saved.lastPromptAt))).toBe(false);
  });

  it('does not show when granted, permanently blocked, or recently denied; decline records denial', async () => {
    const { result } = renderHook(() => usePushPermissionGate());
    getPermissionsAsync.mockResolvedValueOnce({ status: 'granted', canAskAgain: true });
    await act(async () => result.current.presentPrePrompt('first-post-published'));
    expect(result.current.modalState.visible).toBe(false);
    getPermissionsAsync.mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
    await act(async () => result.current.presentPrePrompt('first-post-published'));
    expect(result.current.modalState.visible).toBe(false);
    getPermissionsAsync.mockResolvedValueOnce({ status: 'denied', canAskAgain: true });
    values.set('push_permission_state', JSON.stringify({ lastDecision: 'denied', lastPromptAt: new Date().toISOString(), osPromptShown: false }));
    await act(async () => result.current.presentPrePrompt('first-post-published'));
    expect(result.current.modalState.visible).toBe(false);
    values.clear();
    await act(async () => result.current.handleDecline());
    const saved = JSON.parse(values.get('push_permission_state') ?? '{}') as { lastDecision: string; osPromptShown: boolean };
    expect(saved).toMatchObject({ lastDecision: 'denied', osPromptShown: false });
  });

  it('allows another prompt after the denial cooldown has elapsed and reports denied acceptance', async () => {
    values.set('push_permission_state', JSON.stringify({
      lastDecision: 'denied', lastPromptAt: new Date(Date.now() - 31 * 86_400_000).toISOString(), osPromptShown: true,
    }));
    requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const { result } = renderHook(() => usePushPermissionGate());
    await act(async () => result.current.presentPrePrompt('first-post-published'));
    expect(result.current.modalState.visible).toBe(true);
    await act(async () => expect(await result.current.handleAccept()).toBe('denied'));
    expect(JSON.parse(values.get('push_permission_state') ?? '{}')).toMatchObject({ lastDecision: 'denied', osPromptShown: true });
  });
});
