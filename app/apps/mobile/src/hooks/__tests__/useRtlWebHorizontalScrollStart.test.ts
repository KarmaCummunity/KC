// @vitest-environment jsdom
// #1747 — RTL web scrolls a horizontal chip row to the reading-start edge;
// LTR and native leave the ScrollView alone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ScrollView } from 'react-native';

const platform = vi.hoisted(() => ({ OS: 'web' as 'web' | 'ios' | 'android' }));
const layoutRtl = vi.hoisted(() => ({ current: true }));

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {
    ...actual,
    Platform: { get OS() { return platform.OS; } },
  };
});

vi.mock('../../lib/rtlLayout', () => ({
  isLayoutRtl: () => layoutRtl.current,
}));

import {
  scrollHorizontalToRtlStart,
  shouldScrollHorizontalToRtlStart,
  useRtlWebHorizontalScrollStart,
} from '../useRtlWebHorizontalScrollStart';

afterEach(() => {
  platform.OS = 'web';
  layoutRtl.current = true;
  vi.clearAllMocks();
});

describe('shouldScrollHorizontalToRtlStart', () => {
  it('is true only on RTL web', () => {
    platform.OS = 'web';
    layoutRtl.current = true;
    expect(shouldScrollHorizontalToRtlStart()).toBe(true);

    layoutRtl.current = false;
    expect(shouldScrollHorizontalToRtlStart()).toBe(false);

    platform.OS = 'ios';
    layoutRtl.current = true;
    expect(shouldScrollHorizontalToRtlStart()).toBe(false);
  });
});

describe('scrollHorizontalToRtlStart', () => {
  it('scrolls to the end on RTL web', () => {
    platform.OS = 'web';
    layoutRtl.current = true;
    const scrollToEnd = vi.fn();
    scrollHorizontalToRtlStart({ scrollToEnd } as unknown as ScrollView);
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  });

  it('is a no-op on LTR web, native, and a null ref', () => {
    const scrollToEnd = vi.fn();
    const scroll = { scrollToEnd } as unknown as ScrollView;

    platform.OS = 'web';
    layoutRtl.current = false;
    scrollHorizontalToRtlStart(scroll);

    platform.OS = 'android';
    layoutRtl.current = true;
    scrollHorizontalToRtlStart(scroll);

    scrollHorizontalToRtlStart(null);
    expect(scrollToEnd).not.toHaveBeenCalled();
  });
});

describe('useRtlWebHorizontalScrollStart', () => {
  it('scrolls to end when content size changes on RTL web', () => {
    platform.OS = 'web';
    layoutRtl.current = true;
    const scrollToEnd = vi.fn();
    const { result } = renderHook(() => useRtlWebHorizontalScrollStart());
    // Pretend the ScrollView mounted and attached the ref.
    (result.current.ref as { current: ScrollView | null }).current =
      { scrollToEnd } as unknown as ScrollView;

    result.current.onContentSizeChange(640, 40);
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  });

  it('does not scroll on LTR web', () => {
    platform.OS = 'web';
    layoutRtl.current = false;
    const scrollToEnd = vi.fn();
    const { result } = renderHook(() => useRtlWebHorizontalScrollStart());
    (result.current.ref as { current: ScrollView | null }).current =
      { scrollToEnd } as unknown as ScrollView;

    result.current.onContentSizeChange(640, 40);
    expect(scrollToEnd).not.toHaveBeenCalled();
  });
});
