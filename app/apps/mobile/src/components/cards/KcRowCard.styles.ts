import { StyleSheet } from 'react-native';
import { makeUseStyles, radius, shadow, spacing, typography } from '@kc/ui';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

export const useKcRowCardStyles = makeUseStyles(({ colors }) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  closed: { opacity: 0.72 },
  main: { flexDirection: rowDirectionStart, alignItems: 'center' as const, gap: spacing.md },
  thumb: { borderRadius: radius.md, overflow: 'hidden' as const, alignItems: 'center' as const, justifyContent: 'center' as const },
  thumbGive: { backgroundColor: colors.primarySurface },
  thumbRequest: { backgroundColor: `${colors.secondary}18` },
  image: { ...StyleSheet.absoluteFillObject },
  body: { flex: 1, minWidth: 0, gap: spacing.xs },
  chips: { flexDirection: rowDirectionStart, flexWrap: 'wrap' as const, gap: spacing.xs },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full },
  givePill: { backgroundColor: colors.primarySurface },
  requestPill: { backgroundColor: `${colors.secondary}18` },
  pillText: { ...typography.caption, ...typography.bold },
  givePillText: { color: colors.giveTag },
  requestPillText: { color: colors.secondary },
  mutedPill: { backgroundColor: colors.border },
  mutedPillText: { color: colors.textSecondary },
  statusPill: { backgroundColor: colors.primaryLight },
  statusPillText: { color: colors.primary },
  title: { ...typography.body, ...typography.semiBold, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  openLink: { flexDirection: rowDirectionStart, alignItems: 'center' as const, gap: spacing.xs },
  openLinkText: { ...typography.caption, ...typography.semiBold, color: colors.primary },
  trailing: { flexShrink: 0 },
  footer: { flexDirection: rowDirectionStart, flexWrap: 'wrap' as const, gap: spacing.md, marginTop: spacing.sm },
}));
