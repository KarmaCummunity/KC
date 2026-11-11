// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Keyboard } from 'react-native';
import { formKeyboardAccessoryProps, useFormFieldFocus } from '../useFormFieldFocus';

describe('useFormFieldFocus', () => {
  it('bindField wires returnKeyType next/done by index', () => {
    const { result } = renderHook(() => useFormFieldFocus(3));
    expect(result.current.bindField(0).returnKeyType).toBe('next');
    expect(result.current.bindField(2).returnKeyType).toBe('done');
  });

  it('dismiss calls Keyboard.dismiss', () => {
    const spy = vi.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const { result } = renderHook(() => useFormFieldFocus(1));
    act(() => {
      result.current.dismiss();
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('formKeyboardAccessoryProps maps focus handlers for FormScreen', () => {
    const { result } = renderHook(() => useFormFieldFocus(2));
    const props = formKeyboardAccessoryProps(result.current);
    expect(props.onPrev).toBe(result.current.focusPrev);
    expect(props.onDone).toBe(result.current.dismiss);
    expect(props).toHaveProperty('canGoPrev');
    expect(props).toHaveProperty('canGoNext');
  });

  it('focusNext / focusPrev move one field and stop at the ends', () => {
    const spy = vi.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const { result } = renderHook(() => useFormFieldFocus(3));
    const focus = [vi.fn(), vi.fn(), vi.fn()];
    focus.forEach((fn, i) => {
      (result.current.bindField(i).ref as { current: unknown }).current = { focus: fn };
    });
    // Nothing focused yet: next goes to the first field, prev to the last.
    act(() => result.current.focusNext());
    expect(focus[0]).toHaveBeenCalledTimes(1);
    act(() => result.current.focusPrev());
    expect(focus[2]).toHaveBeenCalledTimes(1);
    act(() => result.current.bindField(1).onFocus());
    act(() => result.current.focusNext());
    expect(focus[2]).toHaveBeenCalledTimes(2);
    act(() => result.current.focusPrev());
    expect(focus[0]).toHaveBeenCalledTimes(2);
    // From the last field, next dismisses the keyboard; from the first, prev does nothing.
    act(() => result.current.bindField(2).onFocus());
    act(() => result.current.focusNext());
    expect(spy).toHaveBeenCalledTimes(1);
    act(() => result.current.bindField(0).onFocus());
    act(() => result.current.focusPrev());
    expect(focus.map((f) => f.mock.calls.length)).toEqual([2, 0, 2]);
    spy.mockRestore();
  });
});
