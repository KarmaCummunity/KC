// FR-RESP-006 AC25 — scrolling a form field into view, web and native.
import { describe, expect, it, vi } from 'vitest';
import type { ScrollView, View } from 'react-native';
import { SCROLL_TOP_PADDING, scrollFieldWithWindow, scrollWebFieldIntoView } from '../scrollIntoView';

describe('scrollWebFieldIntoView', () => {
  it('calls scrollIntoView when the host element supports it', () => {
    const scrollIntoView = vi.fn();
    expect(scrollWebFieldIntoView({ scrollIntoView } as unknown as View)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  it('returns false when scrollIntoView is missing', () => {
    expect(scrollWebFieldIntoView({} as View)).toBe(false);
  });
});

describe('scrollFieldWithWindow', () => {
  it('scrolls by the field offset inside the scroller, keeping the top padding', () => {
    const scrollTo = vi.fn();
    const scroll = { scrollTo, measureInWindow: (cb: (x: number, y: number) => void) => cb(0, 100) } as unknown as ScrollView;
    const node = { measureInWindow: (cb: (x: number, y: number) => void) => cb(0, 420) } as unknown as View;
    scrollFieldWithWindow(scroll, node, 80, SCROLL_TOP_PADDING);
    expect(scrollTo).toHaveBeenCalledWith({ y: 80 + (420 - 100) - SCROLL_TOP_PADDING, animated: true });
  });

  it('never scrolls above the top', () => {
    const scrollTo = vi.fn();
    const scroll = { scrollTo, measureInWindow: (cb: (x: number, y: number) => void) => cb(0, 100) } as unknown as ScrollView;
    const node = { measureInWindow: (cb: (x: number, y: number) => void) => cb(0, 104) } as unknown as View;
    scrollFieldWithWindow(scroll, node, 0, SCROLL_TOP_PADDING);
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });
});
