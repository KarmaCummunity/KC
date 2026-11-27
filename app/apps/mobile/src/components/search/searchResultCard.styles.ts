// Shared styles for UserResultCard, PostResultCard, LinkResultCard.
import { makeUseStyles, radius, shadow, spacing, typography } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlLayout';
export const useSearchResultCardStyles = makeUseStyles(({ colors, isDark }) => ({
  card: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: isDark ? 1 : 0,
    borderColor: isDark ? colors.border : 'transparent',
    gap: spacing.md,
    marginBottom: spacing.sm,
    ...shadow.card,
    shadowOpacity: isDark ? 0 : shadow.card.shadowOpacity,
    elevation: isDark ? 0 : shadow.card.elevation,
  },
  cardPressed: { backgroundColor: colors.background },
  cardContent: { flex: 1, gap: 2 }, // brand-guard-allow: 2px title stack is tighter than spacing.xs
  cardTitle: {
    ...typography.body,
    ...typography.semiBold,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
  },
  cardHandle: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  cardSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    marginTop: 2, // brand-guard-allow: 2px subtitle offset is tighter than spacing.xs
  },
  metaRow: {
    flexDirection: 'row' as const,
    gap: spacing.md,
    marginTop: spacing.xs,
    justifyContent: 'flex-end' as const,
  },
  metaChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs },
  metaText: { ...typography.caption, color: colors.textSecondary },
  avatarWrap: { width: 48, height: 48, borderRadius: radius.xl, overflow: 'hidden' as const, flexShrink: 0 },
  postThumb: { width: 56, height: 56, borderRadius: radius.md, overflow: 'hidden' as const },
  postThumbPlaceholder: {
    backgroundColor: colors.background,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  postTitleRow: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, marginBottom: 2 }, // brand-guard-allow: 2px title row offset is tighter than spacing.xs
  typeTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm }, // brand-guard-allow: 2px tag padding is tighter than spacing.xs
  typeTagText: { ...typography.caption, ...typography.semiBold },
  linkIconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.xl,
    backgroundColor: colors.secondaryLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  categoryTag: {
    alignSelf: 'flex-end' as const,
    backgroundColor: colors.primarySurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2, // brand-guard-allow: 2px tag padding is tighter than spacing.xs
    borderRadius: radius.sm,
    marginTop: 2, // brand-guard-allow: 2px category offset is tighter than spacing.xs
  },
  categoryTagText: { ...typography.caption, color: colors.primary, ...typography.semiBold },
  linkUrl: {
    ...typography.caption,
    color: colors.textDisabled,
    textAlign: rtlTextAlignStart,
    fontSize: 10, // brand-guard-allow: 10px URL is smaller than typography.caption
    marginTop: 2, // brand-guard-allow: 2px URL offset is tighter than spacing.xs
  },
}));
