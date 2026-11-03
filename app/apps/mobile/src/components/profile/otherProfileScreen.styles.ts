import { makeUseStyles, radius, shadow, spacing, typography } from '@kc/ui';

const S = spacing;

export const useOtherProfileScreenStyles = makeUseStyles(({ colors, isDark }) => ({
  container: { flex: 1, backgroundColor: colors.background },
  notFound: { padding: S.xl, alignItems: 'center' as const, gap: S.sm },
  notFoundText: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' as const },
  unavailableHint: { ...typography.body, color: colors.textSecondary, textAlign: 'center' as const },
  card: {
    margin: S.base,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: S.base,
    gap: S.base,
    borderWidth: isDark ? 1 : 0,
    borderColor: isDark ? colors.border : 'transparent',
    ...shadow.card,
    shadowOpacity: isDark ? 0 : shadow.card.shadowOpacity,
    elevation: isDark ? 0 : shadow.card.elevation,
  },
  actionRow: { flexDirection: 'row' as const, gap: S.sm, alignItems: 'center' as const },
  btnFlex: { flex: 1 },
  msgBtn: {
    flex: 1,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: S.md,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    flexDirection: 'row' as const,
    gap: S.xs,
  },
  msgBtnText: { ...typography.button, color: colors.textPrimary },
  adminLink: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: S.xs,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySurface,
  },
  adminLinkText: { ...typography.button, color: colors.primary },
}));
