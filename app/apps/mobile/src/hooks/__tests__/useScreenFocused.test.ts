// @vitest-environment jsdom
// #2571 — focus state of a stack screen, driven by expo-router's focus effect.
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const focus = vi.hoisted(() => ({ effect: null as null | (() => void | (() => void)) }));
vi.mock('expo-router', () => ({
  // Records the callback; the test plays the navigator's focus and blur.
  useFocusEffect: (effect: () => void | (() => void)) => {
    focus.effect = effect;
  },
}));

import { useScreenFocused } from '../useScreenFocused';

describe('useScreenFocused', () => {
  it('starts focused, turns false on blur and true again on focus', () => {
    const { result } = renderHook(() => useScreenFocused());
    expect(result.current).toBe(true);

    let blur: void | (() => void);
    act(() => {
      blur = focus.effect?.();
    });
    expect(result.current).toBe(true);

    act(() => (blur as () => void)());
    expect(result.current).toBe(false);

    act(() => {
      focus.effect?.();
    });
    expect(result.current).toBe(true);
  });
});
