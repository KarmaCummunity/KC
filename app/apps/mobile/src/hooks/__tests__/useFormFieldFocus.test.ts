// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Keyboard } from 'react-native';
import { useFormFieldFocus } from '../useFormFieldFocus';

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
});
