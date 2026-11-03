import { I18nManager, Platform, type ViewStyle } from 'react-native';
import { makeUseStyles, radius, shadow, spacing, typography } from '@kc/ui';
import { isLayoutRtl } from '../lib/rtlLayout';

const isRTL = I18nManager.isRTL;
const isWeb = Platform.OS === 'web';

/** Dark glass — readable on both light and dark post images regardless of app theme. */
const IMAGE_OVERLAY_BG = 'rgba(0, 0, 0, 0.68)';
const IMAGE_OVERLAY_BORDER = 'rgba(255, 255, 255, 0.22)';
const IMAGE_OVERLAY_TEXT = '#FFFFFF';

/** Text alignment toward reading start; mirrors native RTL via I18nManager. */
export const alignStart: 'left' | 'right' = isRTL ? 'left' : 'right';

function cornerStart(): Pick<ViewStyle, 'left' | 'right' | 'start'> {
  if (!isWeb) return { start: spacing.sm };
  return isLayoutRtl() ? { right: spacing.sm } : { left: spacing.sm };
}

function cornerEnd(): Pick<ViewStyle, 'left' | 'right' | 'end'> {
  if (!isWeb) return { end: spacing.sm };
  return isLayoutRtl() ? { left: spacing.sm } : { right: spacing.sm };
}

/** Tighter insets for 3-column profile grids (narrow cards). */
function cornerStartDense(): Pick<ViewStyle, 'left' | 'right' | 'start'> {
  if (!isWeb) return { start: spacing.xs };
  return isLayoutRtl() ? { right: spacing.xs } : { left: spacing.xs };
}

function cornerEndDense(): Pick<ViewStyle, 'left' | 'right' | 'end'> {
  if (!isWeb) return { end: spacing.xs };
  return isLayoutRtl() ? { left: spacing.xs } : { right: spacing.xs };
}

const overlayShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.28,
  shadowRadius: 4,
  elevation: 3,
};

export const usePostCardGridStyles = makeUseStyles(({ colors, isDark }) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: isDark ? 1 : 0,
    borderColor: isDark ? colors.border : 'transparent',
    ...shadow.card,
    shadowOpacity: isDark ? 0 : shadow.card.shadowOpacity,
    elevation: isDark ? 0 : shadow.card.elevation,
  },
  imageArea: {
    width: '100%',
    backgroundColor: colors.skeleton,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  placeholderTint: {
    ...Platform.select({
      default: {},
      web: { opacity: 0.92 },
    }),
  },
  typePill: {
    position: 'absolute',
    top: spacing.sm,
    ...cornerEnd(),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: IMAGE_OVERLAY_BG,
    borderWidth: 1,
    borderColor: IMAGE_OVERLAY_BORDER,
    ...overlayShadow,
  },
  typePillText: {
    ...typography.label,
    fontSize: 10,
    fontWeight: '700',
  },
  givePillText: { color: colors.giveTag },
  requestPillText: { color: IMAGE_OVERLAY_TEXT },
  menuOverlay: {
    position: 'absolute',
    top: spacing.sm,
    ...cornerStart(),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: IMAGE_OVERLAY_BG,
    borderWidth: 1,
    borderColor: IMAGE_OVERLAY_BORDER,
    borderRadius: radius.full,
    width: 30,
    height: 30,
    overflow: 'hidden',
    ...overlayShadow,
  },
  roleBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    ...cornerStart(),
    backgroundColor: IMAGE_OVERLAY_BG,
    borderWidth: 1,
    borderColor: IMAGE_OVERLAY_BORDER,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    ...overlayShadow,
  },
  roleBadgeText: {
    ...typography.label,
    fontSize: 10,
    fontWeight: '700',
    color: IMAGE_OVERLAY_TEXT,
  },
  /** Profile 3-up grid — smaller overlays so the image stays visible. */
  typePillDense: {
    top: spacing.xs,
    ...cornerEndDense(),
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  typePillTextDense: {
    fontSize: 8,
    lineHeight: 10,
  },
  menuOverlayDense: {
    top: spacing.xs,
    ...cornerStartDense(),
    width: 22,
    height: 22,
  },
  roleBadgeDense: {
    bottom: spacing.xs,
    ...cornerStartDense(),
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  roleBadgeTextDense: {
    fontSize: 8,
    lineHeight: 10,
  },
  content: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  ownerName: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  title: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: alignStart,
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: -0.2,
    flex: 1,
  },
  /** Title column — holds the (translatable) title + optional indicator; takes
   * the remaining row space beside the category chip. */
  titleCol: { flex: 1, minHeight: 38 },
  /** FR-TRANSLATE-003 — discreet "translating…" hint under the source title. */
  translatingIndicator: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textDisabled,
    textAlign: alignStart,
    marginTop: 1,
  },
  /** Profile 3-up grid — smaller title beside compact category pill. */
  titleDense: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: -0.15,
  },
  categoryChip: {
    flexShrink: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: isDark ? `${colors.primary}22` : colors.primarySurface,
    borderWidth: 1,
    borderColor: isDark ? `${colors.primary}44` : colors.primaryLight,
  },
  categoryChipDense: {
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  categoryChipText: {
    ...typography.label,
    fontSize: 10,
    color: isDark ? colors.giveTag : colors.primaryDark,
    fontWeight: '700',
  },
  categoryChipTextDense: {
    fontSize: 8,
    lineHeight: 10,
  },
  metaFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: 2,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flex: 1,
    minWidth: 0,
  },
  locationText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textSecondary,
    flexShrink: 1,
    textAlign: alignStart,
  },
  timeAgo: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textDisabled,
    letterSpacing: 0.2,
    flexShrink: 0,
  },
}));
