// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBreakpoint } from '../theme/useBreakpoint';

vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  let width = 1280;
  return {
    ...actual,
    useWindowDimensions: () => ({ width, height: 800, scale: 1, fontScale: 1 }),
    __setMockWidth: (w: number) => { width = w; },
  };
});

// eslint-disable-next-line no-restricted-imports -- namespace import reaches the mocked width setter, not Text
import * as RN from 'react-native';
const setMockWidth = (RN as unknown as { __setMockWidth: (w: number) => void }).__setMockWidth;

describe('useBreakpoint', () => {
  beforeEach(() => { setMockWidth(1280); });

  it('returns "mobile" below 768', () => {
    setMockWidth(375);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('mobile');
  });

  it('returns "tablet" at 768', () => {
    setMockWidth(768);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('tablet');
  });

  it('returns "tablet" at 1023', () => {
    setMockWidth(1023);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('tablet');
  });

  it('returns "desktop" at 1024', () => {
    setMockWidth(1024);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('desktop');
  });

  it('returns "desktop" at 1439', () => {
    setMockWidth(1439);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('desktop');
  });

  it('returns "wide" at 1440', () => {
    setMockWidth(1440);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('wide');
  });
});
