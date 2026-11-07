// Geometry for the bottom tab bar (#1213).
// The bar is docked fully flush with the screen bottom (offset 0). Its own
// background extends under the home indicator / gesture bar, and the icons
// are padded up by the bottom safe-area inset so they stay tappable. The inset
// is counted exactly once — as padding inside the bar, never as an offset.

/** Bottom offset (px) of the bar from the viewport edge — always flush. */
export function tabBarBottomOffset(): number {
  return 0;
}

// The home indicator is a thin strip at the very bottom of the safe-area
// inset; the icons only need to clear it, not the whole inset (#1631).
const HOME_INDICATOR_SLACK = 12;

/** Inner bottom padding that lifts the icons above the home indicator. */
export function tabBarBottomPadding(insetBottom: number): number {
  if (!Number.isFinite(insetBottom) || insetBottom <= 0) return 0;
  return Math.max(insetBottom - HOME_INDICATOR_SLACK, 0);
}

/** Total rendered bar height: icon row + safe-area padding. */
export function tabBarTotalHeight(rowHeight: number, insetBottom: number): number {
  return rowHeight + tabBarBottomPadding(insetBottom);
}
