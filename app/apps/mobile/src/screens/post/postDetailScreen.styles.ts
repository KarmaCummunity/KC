// Styles extracted from app/post/[id].tsx to keep the screen under the
// 300-LOC cap (TD-29).
import { Platform, type ViewStyle } from 'react-native';
import { darkColors, lightColors, makeUseStyles, radius, shadow, spacing, typography, zIndex } from '@kc/ui';
import { heroCornerEnd, heroCornerStart } from '../../components/post-detail/postDetailCorner';
import { rowDirectionStart, selfAlignStart, textAlignStart } from '../../lib/rtlLayout';

// Over a photo the scrim, hairline and label stay the same in both themes.
const IMAGE_OVERLAY_BG = darkColors.overlay;
const IMAGE_OVERLAY_BORDER = `${lightColors.textInverse}38`;
const IMAGE_OVERLAY_TEXT = lightColors.textInverse;
const LOCATION_ICON_SIZE = 28;

const overlayShadow = { ...shadow.card, shadowOpacity: shadow.glow.shadowOpacity };

export const usePostDetailStyles = makeUseStyles(({ colors, isDark }) => ({
  container: { flex: 1, backgroundColor: colors.background },
  headerActions: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    // headerRight slot is wide; pack icons to the screen edge (visual left in RTL).
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.base,
    backgroundColor: colors.background,
  },
  errorTitle: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  retryText: { ...typography.button, color: colors.textInverse },

  imageWrap: {
    position: 'relative',
    marginHorizontal: spacing.base,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: isDark ? 1 : 0,
    borderColor: isDark ? colors.border : 'transparent',
    ...shadow.card,
    shadowColor: colors.shadow,
    shadowOpacity: isDark ? 0 : shadow.card.shadowOpacity,
    elevation: isDark ? 0 : shadow.card.elevation,
  },
  imageWrapClosed: {
    borderColor: isDark ? colors.success : `${colors.success}55`,
    borderWidth: 1,
  },
  closedImageTint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '38%',
    backgroundColor: `${colors.success}${isDark ? '1F' : '24'}`,
  },
  statusBadgePos: {
    position: 'absolute',
    top: spacing.base,
    zIndex: zIndex.overlay,
    ...(heroCornerStart(spacing.base) as ViewStyle),
  },
  typeTagOverlay: {
    position: 'absolute',
    bottom: spacing.base,
    zIndex: zIndex.overlay,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: IMAGE_OVERLAY_BG,
    borderWidth: 1,
    borderColor: IMAGE_OVERLAY_BORDER,
    ...overlayShadow,
    ...(heroCornerEnd(spacing.base) as ViewStyle),
  },
  giveTagText: { ...typography.label, ...typography.bold, color: colors.giveTag },
  requestTagText: { ...typography.label, ...typography.bold, color: IMAGE_OVERLAY_TEXT },

  content: {
    marginHorizontal: spacing.base,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    gap: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: isDark ? colors.border : `${colors.border}88`,
    ...shadow.card,
    shadowColor: colors.shadow,
    elevation: isDark ? 0 : shadow.card.elevation,
  },
  contentInset: {
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: isDark ? colors.surfaceRaised : colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contentClosed: {
    borderColor: isDark ? `${colors.success}44` : `${colors.success}33`,
    borderWidth: 1,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: textAlignStart(),
    letterSpacing: -0.2,
    lineHeight: 28,
  },
  translationBar: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    alignSelf: selfAlignStart,
    gap: spacing.xs,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  autoTranslatedLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: textAlignStart(),
  },
  showOriginalLink: {
    ...typography.caption,
    ...typography.semiBold,
    color: colors.primary,
    textAlign: textAlignStart(),
  },
  metaChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignSelf: 'flex-start',
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: isDark ? colors.surfaceRaised : colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaChipText: {
    ...typography.caption,
    ...typography.semiBold,
    color: colors.textPrimary,
  },
  description: {
    ...typography.body,
    fontSize: typography.button.fontSize,
    color: colors.textPrimary,
    textAlign: textAlignStart(),
  },
  sectionDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  metaSection: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  locationIcon: {
    width: LOCATION_ICON_SIZE,
    height: LOCATION_ICON_SIZE,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
    textAlign: textAlignStart(),
  },
  timeText: {
    ...typography.caption,
    color: colors.textDisabled,
    textAlign: textAlignStart(),
    paddingStart: LOCATION_ICON_SIZE + spacing.sm,
  },
  authorCard: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  authorInfo: { flex: 1, gap: spacing.xs / 2 },
  authorName: {
    ...typography.body,
    ...typography.semiBold,
    color: colors.textPrimary,
    textAlign: textAlignStart(),
  },
  authorCity: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: textAlignStart(),
  },
  authorLabel: {
    ...typography.caption,
    color: colors.textDisabled,
    textAlign: textAlignStart(),
    marginBottom: spacing.xs,
    ...typography.semiBold,
  },

  // Floating, self-centered pill CTA — sits above content, no full-width bar.
  cta: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    ...Platform.select({
      default: {},
      web: {},
    }),
  },
  messageBtn: {
    height: 44,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md + spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadow.glow,
    shadowColor: colors.primary,
  },
  messageBtnText: { ...typography.button, color: colors.textInverse },
}));
