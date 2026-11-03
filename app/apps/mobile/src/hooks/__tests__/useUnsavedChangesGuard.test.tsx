// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addListener, dispatch, alert } = vi.hoisted(() => ({ addListener: vi.fn(), dispatch: vi.fn(), alert: vi.fn() }));
vi.mock('expo-router', () => ({ useNavigation: () => ({ addListener, dispatch }) }));
vi.mock('react-native', () => ({ Alert: { alert }, Platform: { OS: 'ios' } }));
import { Platform } from 'react-native';
import { useUnsavedChangesGuard } from '../useUnsavedChangesGuard';

type BeforeRemove = (event: { preventDefault: () => void; data: { action: unknown } }) => void;
let listener: BeforeRemove | undefined;
const action = { type: 'GO_BACK' };
beforeEach(() => {
  vi.clearAllMocks();
  listener = undefined;
  addListener.mockImplementation((_event: string, cb: BeforeRemove) => { listener = cb; return vi.fn(); });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('useUnsavedChangesGuard', () => {
  it('does not subscribe while clean and removes its listener on unmount', () => {
    const { rerender, unmount } = renderHook((isDirty: boolean) => useUnsavedChangesGuard({ isDirty, title: 'Unsaved', message: 'Leave?', discardLabel: 'Discard', cancelLabel: 'Stay' }), { initialProps: false });
    expect(addListener).not.toHaveBeenCalled();
    rerender(true);
    expect(addListener).toHaveBeenCalledWith('beforeRemove', expect.any(Function));
    const unsubscribe = addListener.mock.results[0]?.value as ReturnType<typeof vi.fn>;
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('uses native confirmation and dispatches only when discard is pressed', () => {
    vi.spyOn(Platform, 'OS', 'get').mockReturnValue('ios');
    renderHook(() => useUnsavedChangesGuard({ isDirty: true, title: 'Unsaved', message: 'Leave?', discardLabel: 'Discard', cancelLabel: 'Stay' }));
    const preventDefault = vi.fn();
    act(() => listener?.({ preventDefault, data: { action } }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith('Unsaved', 'Leave?', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: expect.any(Function) },
    ]);
    const buttons = alert.mock.calls[0]?.[2] as Array<{ onPress?: () => void }>;
    act(() => buttons[1]?.onPress?.());
    expect(dispatch).toHaveBeenCalledWith(action);
  });

  it('uses window.confirm on web and dispatches only after approval', () => {
    vi.spyOn(Platform, 'OS', 'get').mockReturnValue('web');
    const confirm = vi.fn(() => false);
    Object.defineProperty(globalThis, 'confirm', { configurable: true, value: confirm });
    renderHook(() => useUnsavedChangesGuard({ isDirty: true, title: 'Unsaved', message: 'Leave?', discardLabel: 'Discard', cancelLabel: 'Stay' }));
    const preventDefault = vi.fn();
    act(() => listener?.({ preventDefault, data: { action } }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith('Leave?');
    expect(dispatch).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    act(() => listener?.({ preventDefault, data: { action } }));
    expect(dispatch).toHaveBeenCalledWith(action);
    expect(alert).not.toHaveBeenCalled();
  });
});
