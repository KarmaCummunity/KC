import { describe, expect, it } from 'vitest';
import { tabBarBottomOffset, tabBarBottomPadding, tabBarTotalHeight } from '../tabBarGeometry';

const TAB_BAR_HEIGHT = 60; // TabBar.tsx / useShellTabBarVisibility.ts
const SCROLL_EXTRA = 20; // useShellTabBarScrollInset default (spacing.lg)

// Regression for #1213: the bar floated a full safe-area inset above the
// screen bottom, leaving a visible gap. It must be docked fully flush.
describe('tab bar geometry (#1213)', () => {
  it.each([0, 20, 34, 48])('is flush with the bottom (offset 0) for inset %i', () => {
    expect(tabBarBottomOffset()).toBe(0);
  });

  it.each([0, 20, 34, 48])('pads icons up by exactly the inset (%i)', (inset) => {
    expect(tabBarBottomPadding(inset)).toBe(inset);
    expect(tabBarTotalHeight(TAB_BAR_HEIGHT, inset)).toBe(TAB_BAR_HEIGHT + inset);
  });

  it('never double-counts the inset (offset + padding === inset)', () => {
    for (const inset of [0, 34, 48]) {
      expect(tabBarBottomOffset() + tabBarBottomPadding(inset)).toBe(inset);
    }
  });

  it('treats negative / NaN insets as 0', () => {
    expect(tabBarBottomPadding(-5)).toBe(0);
    expect(tabBarBottomPadding(Number.NaN)).toBe(0);
  });

  it('scroll padding keeps last items visible above the bar', () => {
    for (const inset of [0, 34]) {
      const barTop = tabBarBottomOffset() + tabBarTotalHeight(TAB_BAR_HEIGHT, inset);
      expect(SCROLL_EXTRA + TAB_BAR_HEIGHT + inset).toBeGreaterThanOrEqual(barTop);
    }
  });
});
