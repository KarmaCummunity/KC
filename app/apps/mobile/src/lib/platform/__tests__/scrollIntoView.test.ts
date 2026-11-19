// FR-RESP-006 AC25 — scrolling a form field into view, web and native.
import { describe, expect, it, vi } from 'vitest';
import type { ScrollView, View } from 'react-native';
import {
  SCROLL_TOP_PADDING,
  revealFieldAboveKeyboard,
  revealOffset,
  scrollFieldWithWindow,
  scrollWebFieldIntoView,
} from '../scrollIntoView';

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

// FR-RESP-006 AC25 — keyboard Next / Previous brings the new field into view above the keyboard.
describe('revealOffset', () => {
  const area = { viewportTop: 100, viewportBottom: 500, scrollY: 200, pad: 10 };

  it('leaves the screen alone when the field is already fully visible', () => {
    expect(revealOffset({ ...area, fieldTop: 200, fieldBottom: 260 })).toBeNull();
  });

  it('lifts a field hidden under the keyboard until its bottom sits just above it', () => {
    // Bottom at 560, visible bottom 490: scroll down by 70.
    expect(revealOffset({ ...area, fieldTop: 500, fieldBottom: 560 })).toBe(270);
  });

  it('brings a field above the visible area down to the top edge', () => {
    expect(revealOffset({ ...area, fieldTop: 40, fieldBottom: 90 })).toBe(200 + 40 - 110);
  });

  it('aligns a field taller than the visible area by its top, and never scrolls above zero', () => {
    expect(revealOffset({ ...area, fieldTop: 300, fieldBottom: 900 })).toBe(200 + 300 - 110);
    expect(revealOffset({ ...area, scrollY: 0, fieldTop: 50, fieldBottom: 80 })).toBe(0);
  });
});

describe('revealFieldAboveKeyboard', () => {
  const measure = (y: number, height: number) =>
    ({ measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, y, 300, height) }) as unknown as View;

  it('uses the keyboard top as the visible bottom when it is higher than the scroller', () => {
    const scrollTo = vi.fn();
    const scroll = { ...measure(0, 800), scrollTo } as unknown as ScrollView;
    // Field 600–650, keyboard from 500: the field must move up by 650 - (500 - pad).
    revealFieldAboveKeyboard(scroll, measure(600, 50), 0, 500);
    expect(scrollTo).toHaveBeenCalledWith({ y: 650 - (500 - SCROLL_TOP_PADDING), animated: true });
  });

  it('does not scroll for a field already visible with the keyboard closed', () => {
    const scrollTo = vi.fn();
    const scroll = { ...measure(0, 800), scrollTo } as unknown as ScrollView;
    revealFieldAboveKeyboard(scroll, measure(300, 50), 0, null);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
