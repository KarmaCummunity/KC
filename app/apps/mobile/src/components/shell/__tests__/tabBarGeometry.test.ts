import { describe, expect, it } from 'vitest';
import {
  ownerBarTabClearance,
  tabBarBottomOffset,
  tabBarBottomPadding,
  tabBarTotalHeight,
  tabPlusOverhangPx,
} from '../tabBarGeometry';

const TAB_BAR_HEIGHT = 48; // TabBar.tsx / useShellTabBarVisibility.ts
const SCROLL_EXTRA = 20; // useShellTabBarScrollInset default (spacing.lg)

// Regression for #1213: the bar floated a full safe-area inset above the
// screen bottom, leaving a visible gap. It must be docked fully flush.
describe('tab bar geometry (#1213)', () => {
  it.each([0, 20, 34, 48])('is flush with the bottom (offset 0) for inset %i', () => {
    expect(tabBarBottomOffset()).toBe(0);
  });

  it.each([
    [0, 0],
    [8, 0],
    [20, 8],
    [34, 22],
    [48, 36],
  ])('pads icons only past the home indicator (inset %i -> %i, #1631)', (inset, pad) => {
    expect(tabBarBottomPadding(inset)).toBe(pad);
    expect(tabBarTotalHeight(TAB_BAR_HEIGHT, inset)).toBe(TAB_BAR_HEIGHT + pad);
  });

  it('never exceeds the inset (offset + padding <= inset)', () => {
    for (const inset of [0, 34, 48]) {
      expect(tabBarBottomOffset() + tabBarBottomPadding(inset)).toBeLessThanOrEqual(inset);
    }
  });

  it('is slimmer than the old 60pt bar on a notched iPhone (#1631)', () => {
    expect(tabBarTotalHeight(TAB_BAR_HEIGHT, 34)).toBeLessThan(60 + 34);
  });

  it('treats negative / NaN insets as 0', () => {
    expect(tabBarBottomPadding(-5)).toBe(0);
    expect(tabBarBottomPadding(Number.NaN)).toBe(0);
  });

  it('lifts a docked action above the raised plus button', () => {
    expect(tabPlusOverhangPx(TAB_BAR_HEIGHT)).toBe(20);
    expect(ownerBarTabClearance(TAB_BAR_HEIGHT, 0)).toBe(TAB_BAR_HEIGHT + 20);
    expect(ownerBarTabClearance(TAB_BAR_HEIGHT, 34)).toBe(48 + 22 + 20);
  });

  it('scroll padding keeps last items visible above the bar', () => {
    for (const inset of [0, 34]) {
      const barTop = tabBarBottomOffset() + tabBarTotalHeight(TAB_BAR_HEIGHT, inset);
      expect(SCROLL_EXTRA + TAB_BAR_HEIGHT + inset).toBeGreaterThanOrEqual(barTop);
    }
  });
});
