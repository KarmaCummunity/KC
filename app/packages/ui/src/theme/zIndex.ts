// ─────────────────────────────────────────────
// Layer (z-index) scale (spec 17 §4, D87)
// ─────────────────────────────────────────────

/**
 * Named stacking layers. The values are the literal z-indexes the app already
 * used, so moving a screen onto the tokens keeps its stacking order unchanged.
 * Order only matters among siblings of one stacking context; React Native
 * `Modal` renders in its own window and needs no layer.
 */
export const zIndex = {
  /** Normal document flow. */
  base: 0,
  /** One step above its siblings (e.g. a counter over an image). */
  raised: 1,
  /** Absolutely-positioned controls and badges over content, a header over its list. */
  overlay: 2,
  /** Floating navigation docked over scrolling content. */
  floating: 20,
  /** Top-most transient surfaces: toasts and environment banners. */
  toast: 9999,
} as const;
