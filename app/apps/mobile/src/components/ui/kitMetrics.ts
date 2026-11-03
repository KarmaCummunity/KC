// Interaction metrics shared by the kit's pressable components (spec 17 §4.1, §5).
//
// These are layout and interaction sizes, not design tokens: they say how big a
// touch target must be and how a disabled control fades, so every kit control
// behaves the same way. Colours, radii, spacing and type still come from @kc/ui.
import type { Insets } from 'react-native';

/**
 * Minimum touch target, in points, for anything a finger can press
 * (WCAG 2.5.5 / Apple HIG 44pt). A control drawn smaller extends its hit
 * area with `hitSlop` up to this size instead of growing visually.
 */
export const MIN_TAP_TARGET = 44;

/** Opacity of a disabled or busy control, so it reads as unavailable in both palettes. */
export const DISABLED_OPACITY = 0.5;

/**
 * Vertical `hitSlop` that grows a control of `height` points to the
 * {@link MIN_TAP_TARGET}. Returns `undefined` when the control is already tall
 * enough, so tall controls pass no slop at all.
 *
 * Note: React Native Web ignores `hitSlop`; on web a pointer is precise and the
 * visual size is what counts.
 */
export function tapTargetHitSlop(height: number): Insets | undefined {
  // Half of the missing height above and half below, so the target stays centred.
  const missing = Math.max(0, MIN_TAP_TARGET - height) / 2;
  return missing > 0 ? { top: missing, bottom: missing } : undefined;
}
