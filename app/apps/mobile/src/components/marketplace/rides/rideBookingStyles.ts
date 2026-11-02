// Shared styles for the ride booking views (driver list and passenger booking).
import { makeUseStyles, radius, spacing, typography } from '@kc/ui';

export const useRideBookingStyles = makeUseStyles(({ colors }) => ({
  box: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  caption: { ...typography.caption, color: colors.textSecondary },
  row: { gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  name: { ...typography.bodyLarge, color: colors.textPrimary },
  actions: { flexDirection: 'row' as const, gap: spacing.sm },
  stepper: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  stepperValue: { ...typography.h3, color: colors.textPrimary, minWidth: 24, textAlign: 'center' as const },
}));
