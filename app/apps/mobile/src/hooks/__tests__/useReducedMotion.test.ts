// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { isReduceMotionEnabled, addEventListener, remove } = vi.hoisted(() => ({
  isReduceMotionEnabled: vi.fn(),
  addEventListener: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('react-native', () => ({
  AccessibilityInfo: { isReduceMotionEnabled, addEventListener },
}));

import { useReducedMotion } from '../useReducedMotion';

beforeEach(() => {
  isReduceMotionEnabled.mockReset();
  addEventListener.mockReset();
  remove.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe('useReducedMotion', () => {
  it('starts false and reflects the platform setting', async () => {
    isReduceMotionEnabled.mockResolvedValue(true);
    let onChange: ((value: boolean) => void) | undefined;
    addEventListener.mockImplementation((_event: string, listener: (value: boolean) => void) => {
      onChange = listener;
      return { remove };
    });
    const { result, unmount } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe(true);
    act(() => onChange?.(false));
    expect(result.current).toBe(false);
    expect(addEventListener).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('keeps the default on platform query rejection and ignores updates after unmount', async () => {
    isReduceMotionEnabled.mockRejectedValue(new Error('unavailable'));
    let onChange: ((value: boolean) => void) | undefined;
    addEventListener.mockImplementation((_event: string, listener: (value: boolean) => void) => {
      onChange = listener;
      return { remove };
    });
    const { result, unmount } = renderHook(() => useReducedMotion());
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe(false);
    unmount();
    act(() => onChange?.(true));
    expect(result.current).toBe(false);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
