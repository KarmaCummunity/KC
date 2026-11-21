// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({
  get: vi.fn(), request: vi.fn(), open: vi.fn(), remove: vi.fn(),
  listener: null as null | ((state: string) => void),
}));
vi.mock('expo-notifications', () => ({ getPermissionsAsync: io.get, requestPermissionsAsync: io.request }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, Linking: { openSettings: io.open },
  AppState: { addEventListener: (_: string, callback: (state: string) => void) => {
    io.listener = callback; return { remove: io.remove };
  } },
}));
import { devicePushPermission, useDevicePushPermission } from '../useDevicePushPermission';
beforeEach(() => {
  vi.clearAllMocks(); io.listener = null;
  io.get.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
  io.request.mockResolvedValue({ status: 'granted' });
});
describe('device push permission', () => {
  it('does not call an unrequested permission blocked, and keeps denied-but-askable actionable', () => {
    expect(devicePushPermission({ status: 'undetermined' })).toBe('askable');
    expect(devicePushPermission({ status: 'denied', canAskAgain: true })).toBe('askable');
    expect(devicePushPermission({ status: 'denied', canAskAgain: false })).toBe('blocked');
    expect(devicePushPermission({ status: 'granted' })).toBe('granted');
  });
  it('requests only on explicit enable, then registers the permitted device', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDevicePushPermission(register));
    await waitFor(() => expect(result.current.status).toBe('askable'));
    expect(io.request).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled();
    io.get.mockResolvedValueOnce({ status: 'undetermined', canAskAgain: true }).mockResolvedValue({ status: 'granted' });
    await act(async () => result.current.enable());
    expect(io.request).toHaveBeenCalledOnce(); expect(register).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('granted');
  });
  it('opens Settings only for blocked permission and refreshes when the app resumes', async () => {
    io.get.mockResolvedValue({ status: 'denied', canAskAgain: false });
    const register = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useDevicePushPermission(register));
    await waitFor(() => expect(result.current.status).toBe('blocked'));
    await act(async () => result.current.enable());
    expect(io.open).toHaveBeenCalledOnce(); expect(io.request).not.toHaveBeenCalled();
    io.get.mockResolvedValue({ status: 'granted' });
    await act(async () => io.listener?.('active'));
    expect(register).toHaveBeenCalledOnce(); expect(result.current.status).toBe('granted');
    unmount(); expect(io.remove).toHaveBeenCalledOnce();
  });
  it('does not register after unmount or display an API failure as OS denial', async () => {
    let resolve!: (p: { status: string }) => void;
    io.get.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const register = vi.fn();
    const { unmount } = renderHook(() => useDevicePushPermission(register));
    unmount(); await act(async () => resolve({ status: 'granted' }));
    expect(register).not.toHaveBeenCalled();
    io.get.mockRejectedValue(new Error('native permission unavailable'));
    const { result } = renderHook(() => useDevicePushPermission(register));
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
  it('ignores a permission read started for a previous session', async () => {
    let resolve!: (p: { status: string }) => void;
    io.get.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const oldRegister = vi.fn(); const newRegister = vi.fn();
    const { result, rerender } = renderHook(({ register, session }) => useDevicePushPermission(register, session),
      { initialProps: { register: oldRegister, session: 'old-user' } });
    rerender({ register: newRegister, session: 'new-user' });
    await waitFor(() => expect(result.current.status).toBe('askable'));
    await act(async () => resolve({ status: 'granted' }));
    expect(oldRegister).not.toHaveBeenCalled(); expect(newRegister).not.toHaveBeenCalled();
    expect(result.current.status).toBe('askable');
  });
  it('keeps an actual denial blocked after the user declines the OS prompt', async () => {
    const register = vi.fn();
    const { result } = renderHook(() => useDevicePushPermission(register));
    await waitFor(() => expect(result.current.status).toBe('askable'));
    io.get.mockResolvedValueOnce({ status: 'undetermined' }).mockResolvedValue({ status: 'denied', canAskAgain: false });
    await act(async () => result.current.enable());
    expect(result.current.status).toBe('blocked'); expect(register).not.toHaveBeenCalled();
  });

});
