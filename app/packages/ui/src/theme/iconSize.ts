// ─────────────────────────────────────────────
// Icon size scale (spec 17 §4.2, D87)
// ─────────────────────────────────────────────

/**
 * Glyph sizes for Ionicons, in points. The six steps are the six sizes screens
 * already used most (14–24, about 85% of the literal `size={N}` uses when the
 * scale was set), so adopting the tokens causes no visual change.
 * Hero / illustration glyphs (32+) are not icons in a row of text and stay
 * outside the scale with an allow-marker until a surface needs a shared step.
 */
export const iconSize = {
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
  xl: 22,
  '2xl': 24,
} as const;
