// FR-POST-001 AC6 — scroll-to-field helpers for the listing create form.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScrollView, View } from 'react-native';
import { LISTING_SCROLL_TOP_PADDING, scrollListingFieldIntoView, scrollWebFieldIntoView } from '../listingScrollToField';

describe('scrollWebFieldIntoView', () => {
  it('calls scrollIntoView when the host element supports it', () => {
    const scrollIntoView = vi.fn();
    const node = { scrollIntoView } as unknown as View;
    expect(scrollWebFieldIntoView(node)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  it('returns false when scrollIntoView is missing', () => {
    expect(scrollWebFieldIntoView({} as View)).toBe(false);
  });
});

describe('scrollListingFieldIntoView', () => {
  const scrollTo = vi.fn();
  const scrollToEnd = vi.fn();
  const measureInWindow = vi.fn((cb: (x: number, y: number) => void) => cb(0, 100));
  const scroll = { scrollTo, scrollToEnd, measureInWindow } as unknown as ScrollView;

  beforeEach(() => {
    scrollTo.mockClear();
    measureInWindow.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses measureLayout against the scroll content and scrolls with padding', () => {
    const measureLayout = vi.fn((_parent, success: (x: number, y: number) => void) => success(0, 240));
    const node = { measureLayout } as unknown as View;
    const content = {} as View;

    scrollListingFieldIntoView({ scroll, content, node, scrollY: 50 });

    expect(measureLayout).toHaveBeenCalledWith(content, expect.any(Function), expect.any(Function));
    expect(scrollTo).toHaveBeenCalledWith({
      y: Math.max(0, 240 - LISTING_SCROLL_TOP_PADDING),
      animated: true,
    });
  });

  it('falls back to measureInWindow when measureLayout fails', () => {
    const measureLayout = vi.fn((_parent, _ok, fail: () => void) => fail());
    const node = {
      measureLayout,
      measureInWindow: vi.fn((cb: (x: number, y: number) => void) => cb(0, 420)),
    } as unknown as View;
    const content = {} as View;

    scrollListingFieldIntoView({ scroll, content, node, scrollY: 80 });

    expect(scrollTo).toHaveBeenCalledWith({
      y: Math.max(0, 80 + (420 - 100) - LISTING_SCROLL_TOP_PADDING),
      animated: true,
    });
  });
});
