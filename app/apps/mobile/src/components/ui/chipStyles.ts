// Styles and size metrics for the kit `Chip` (spec 17 §4.1, issue #1285).
//
// Kept apart from the component so each file stays small. Every value is a
// token from @kc/ui except the chip heights, which are layout sizes.
import { iconSize, makeUseStyles, radius, spacing, typography, type ColorPalette } from '@kc/ui';
import { DISABLED_OPACITY, MIN_TAP_TARGET } from './kitMetrics';

/** `md` for forms; `sm` (compact) for filter sheets, dense lists, cards and admin tables. */
export type ChipSize = 'md' | 'sm';

/**
 * Meaning of a status tag. Each tone is a tinted background with readable text
 * (AA in both palettes): the semantic `*Light` fills carry `textPrimary`, and
 * `brand` uses the give-tag pair (`primary` on `primarySurface`) with a
 * `primaryLight` outline, because its fill is too close to the cream page to
 * show an edge on its own. `muted` is the one unfilled tone, for an inactive
 * value (archived, low, other): a `borderStrong` outline with `textSecondary`
 * text on whatever surface the tag sits on.
 */
export type ChipTone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'error' | 'muted';

/** Visual height per size, in points. Interactive chips reach 44pt through `hitSlop`. */
export const CHIP_HEIGHT: Readonly<Record<ChipSize, number>> = { md: 36, sm: 28 };

/** Ionicons glyph size per chip size (leading icon and the remove glyph). */
export const CHIP_ICON_SIZE: Readonly<Record<ChipSize, number>> = { md: iconSize.sm, sm: iconSize.xs };

/** Fill, outline and foreground (text + icon) of a status tag. */
export interface ToneColors {
  readonly background: string;
  readonly border: string;
  readonly foreground: string;
}

/** A semantic tone: its `*Light` fill with primary text; the outline matches the fill (no visible edge). */
function semanticTone(fill: string, colors: ColorPalette): ToneColors {
  return { background: fill, border: fill, foreground: colors.textPrimary };
}

/** Token colours of a status tag for the active palette. */
export function toneColors(tone: ChipTone, colors: ColorPalette): ToneColors {
  switch (tone) {
    case 'brand':
      return { background: colors.primarySurface, border: colors.primaryLight, foreground: colors.primary };
    case 'info':
      return semanticTone(colors.infoLight, colors);
    case 'success':
      return semanticTone(colors.successLight, colors);
    case 'warning':
      return semanticTone(colors.warningLight, colors);
    case 'error':
      return semanticTone(colors.errorLight, colors);
    case 'muted':
      return { background: 'transparent', border: colors.borderStrong, foreground: colors.textSecondary };
    default:
      return semanticTone(colors.secondaryLight, colors);
  }
}

export const useChipStyles = makeUseStyles(({ colors }) => ({
  base: {
    // Plain `row`: it starts on the reading-start edge (native mirrors it under
    // forceRTL, web inherits `dir="rtl"`), so a leading icon sits before the label.
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  size_md: { minHeight: CHIP_HEIGHT.md, paddingHorizontal: spacing.md, gap: spacing.xs },
  size_sm: { minHeight: CHIP_HEIGHT.sm, paddingHorizontal: spacing.sm, gap: spacing.xs },
  // Interactive chips are pills and at least one touch target wide; tags are
  // squarer so a status never reads as something to press.
  interactive: { borderRadius: radius.full, minWidth: MIN_TAP_TARGET },
  tag: { borderRadius: radius.sm },
  // Filter: outlined when off, solid brand when selected.
  filter: { backgroundColor: colors.surface, borderColor: colors.border },
  filterSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  // Removable: an applied value, tinted in the brand colour with a trailing ✕.
  removable: { backgroundColor: colors.primarySurface, borderColor: colors.primaryLight },
  disabled: { opacity: DISABLED_OPACITY },
  // Press feedback: a brand tint on an unselected chip, a deeper orange on a
  // selected one, and a stronger tint on a removable one.
  pressedFilter: { backgroundColor: colors.primarySurface },
  pressedSelected: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  pressedRemovable: { backgroundColor: colors.primaryLight },
  text_md: { ...typography.body, ...typography.medium },
  text_sm: { ...typography.bodySmall, ...typography.medium },
}));
