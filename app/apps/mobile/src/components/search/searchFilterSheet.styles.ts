// Section styles shared by the filter sheets (SearchFilterSheet, RideFilterSheet).
// The sheet frame comes from the kit `BottomSheet` and the chips from the kit `Chip`.
import { makeUseStyles, spacing, typography } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

export const useSearchFilterSheetStyles = makeUseStyles(({ colors }) => ({
  sectionTitle: {
    ...typography.body,
    ...typography.semiBold,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    marginTop: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: spacing.sm,
    justifyContent: 'flex-end' as const,
  },
}));
