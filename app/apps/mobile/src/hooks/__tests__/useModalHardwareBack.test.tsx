// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addEventListener, reservation, platform } = vi.hoisted(() => ({ addEventListener: vi.fn(), reservation: vi.fn(), platform: { os: 'android' } }));
vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return { ...actual, Platform: { ...actual.Platform, get OS() { return platform.os; } }, BackHandler: { ...actual.BackHandler, addEventListener } };
});
vi.mock('../../components/legal/useActiveModalStack', () => ({ useActiveModalReservation: reservation }));
import { useModalHardwareBack } from '../useModalHardwareBack';
let listener: (() => boolean) | undefined;
let remove: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  remove = vi.fn();
  addEventListener.mockImplementation((_event: string, callback: () => boolean) => { listener = callback; return { remove }; });
});
afterEach(() => { cleanup(); listener = undefined; });

describe('useModalHardwareBack', () => {
  it('reserves the active modal and dismisses on hardware back while consuming the event', () => {
    const dismiss = vi.fn();
    renderHook(() => useModalHardwareBack(true, dismiss));
    expect(reservation).toHaveBeenCalledWith(true);
    expect(addEventListener).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
    let handled = false;
    act(() => { handled = listener?.() ?? false; });
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(handled).toBe(true);
  });

  it('does not subscribe while inactive and removes the listener on deactivation or unmount', () => {
    const dismiss = vi.fn();
    const hook = renderHook(({ active }) => useModalHardwareBack(active, dismiss), { initialProps: { active: false } });
    expect(addEventListener).not.toHaveBeenCalled();
    hook.rerender({ active: true });
    expect(addEventListener).toHaveBeenCalledTimes(1);
    hook.rerender({ active: false });
    expect(remove).toHaveBeenCalledTimes(1);
    hook.rerender({ active: true });
    hook.unmount();
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('does not subscribe on web', () => {
    platform.os = 'web';
    renderHook(() => useModalHardwareBack(true, vi.fn()));
    expect(reservation).toHaveBeenCalledWith(true);
    expect(addEventListener).not.toHaveBeenCalled();
    platform.os = 'android';
  });
});
