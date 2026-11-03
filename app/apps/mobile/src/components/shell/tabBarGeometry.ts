// Geometry for the bottom tab bar (#1213).
// The bar is docked fully flush with the screen bottom (offset 0). Its own
// background extends under the home indicator / gesture bar, and the icons
// are padded up by the bottom safe-area inset so they stay tappable. The inset
// is counted exactly once — as padding inside the bar, never as an offset.

/** Bottom offset (px) of the bar from the viewport edge — always flush. */
export function tabBarBottomOffset(): number {
  return 0;
}

/** Inner bottom padding that lifts the icons above the home indicator. */
export function tabBarBottomPadding(insetBottom: number): number {
  return Number.isFinite(insetBottom) && insetBottom > 0 ? insetBottom : 0;
}

/** Total rendered bar height: icon row + safe-area padding. */
export function tabBarTotalHeight(rowHeight: number, insetBottom: number): number {
  return rowHeight + tabBarBottomPadding(insetBottom);
}
