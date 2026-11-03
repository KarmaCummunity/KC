import { makeUseStyles, radius, spacing, typography } from '@kc/ui';
import { rowDirectionStart } from '../../lib/rtlLayout';

export const useKcCardExtraStyles = makeUseStyles(({ colors }) => ({
  routeRow: { flexDirection: rowDirectionStart, alignItems: 'center' as const, gap: spacing.xs },
  routeText: { ...typography.caption, ...typography.bold, color: colors.textPrimary, flexShrink: 1 },
  detailsRow: { flexDirection: rowDirectionStart, flexWrap: 'wrap' as const, gap: spacing.sm },
  detail: { flexDirection: rowDirectionStart, alignItems: 'center' as const, gap: spacing.xs },
  detailText: { ...typography.caption, color: colors.textSecondary },
  statusRow: { flexDirection: rowDirectionStart, flexWrap: 'wrap' as const, gap: spacing.xs },
  statusChip: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusChipText: { ...typography.caption, color: colors.primary },
  closedChip: { backgroundColor: colors.border },
  closedChipText: { ...typography.caption, color: colors.textSecondary },
  closed: { opacity: 0.72 },
  footer: { flexDirection: rowDirectionStart, flexWrap: 'wrap' as const, gap: spacing.sm, marginTop: spacing.sm },
}));

/** Cell wrapper for 2-column card grids (equal width, centred card). */
export const kcGridCell = { width: '50%' as const, alignItems: 'center' as const, marginBottom: spacing.md };
