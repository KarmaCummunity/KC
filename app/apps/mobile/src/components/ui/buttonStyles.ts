// Styles and size metrics for the kit buttons (`Buttons.tsx`, spec 17 §4.1, issue #1286).
//
// Kept apart from the component so each file stays small. Every value is a
// token from @kc/ui except the button heights, which are layout sizes.
import { Platform, StyleSheet, type ViewStyle } from 'react-native';
import { iconSize, makeUseStyles, radius, shadow, spacing, typography } from '@kc/ui';
import { isLayoutRtl } from '../../lib/rtlLayout';
import { DISABLED_OPACITY, MIN_TAP_TARGET } from './kitMetrics';

/**
 * Button sizes. `lg` is the full-bleed call to action (the original 56pt
 * welcome-screen button and the default); `md` sits inside cards and dialogs;
 * `sm` is the compact size for dense admin tables and toolbars (spec 17 §4.3).
 */
export type ButtonSize = 'lg' | 'md' | 'sm';

/** Visual height per size, in points. `sm` reaches the 44pt target through `hitSlop`. */
export const BUTTON_HEIGHT: Readonly<Record<ButtonSize, number>> = { lg: 56, md: 48, sm: 36 };

/** Ionicons glyph size per button size. */
export const BUTTON_ICON_SIZE: Readonly<Record<ButtonSize, number>> = {
  lg: iconSize.lg,
  md: iconSize.md,
  sm: iconSize.sm,
};

/**
 * Trailing-edge inset for the absolutely-positioned `lg` icon.
 * Native auto-mirrors `end`; RN-Web ignores `start`/`end` for absolute
 * positioning, so on web we resolve RTL live and emit a physical key.
 */
function iconSlotCornerEnd(): Pick<ViewStyle, 'left' | 'right' | 'end'> {
  if (Platform.OS !== 'web') return { end: spacing.lg };
  return isLayoutRtl() ? { left: spacing.lg } : { right: spacing.lg };
}

export const useButtonStyles = makeUseStyles(({ colors, isDark }) => ({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minWidth: MIN_TAP_TARGET,
  },
  // Size: height, corner radius and side padding step down together.
  size_lg: { height: BUTTON_HEIGHT.lg, borderRadius: radius.xl, paddingHorizontal: spacing.xl },
  size_md: { height: BUTTON_HEIGHT.md, borderRadius: radius.lg, paddingHorizontal: spacing.lg },
  size_sm: { height: BUTTON_HEIGHT.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, gap: spacing.xs },
  fullWidth: { width: '100%' },
  primary: { backgroundColor: colors.primary },
  // Destructive actions only (D94).
  danger: { backgroundColor: colors.error },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    // The neutral card lift in light mode; dark mode relies on the border alone.
    shadowColor: colors.shadow,
    shadowOffset: shadow.card.shadowOffset,
    shadowOpacity: isDark ? 0 : shadow.card.shadowOpacity,
    shadowRadius: shadow.card.shadowRadius,
    elevation: isDark ? 0 : shadow.card.elevation,
  },
  ghost: { backgroundColor: 'transparent' },
  // An alarm: the surface with an `error` outline (spec 17 §8.1 call 7).
  alert: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.error },
  inactive: { opacity: DISABLED_OPACITY },
  // Label type per size: the button preset at body-large size for `lg` (as before),
  // the plain button preset for `md`, and a semi-bold body for the compact `sm`.
  text_lg: { ...typography.button, fontSize: typography.bodyLarge.fontSize, textAlign: 'center' },
  text_md: { ...typography.button, textAlign: 'center' },
  text_sm: { ...typography.body, ...typography.semiBold, textAlign: 'center' },
  // Text on the solid fills (primary, danger).
  textOnFill: { color: colors.textInverse },
  textOnSurface: { color: colors.textPrimary },
  textOnGhost: { color: colors.primary },
  textOnAlert: { color: colors.error },
  // While loading, the label and icon keep their space (so the button does not resize) but are not drawn.
  hidden: { opacity: 0 },
  spinner: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  iconSlot: {
    position: 'absolute',
    ...iconSlotCornerEnd(),
    width: iconSize['2xl'],
    height: iconSize['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
