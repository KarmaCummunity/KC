// Shared styles for the ride booking views (driver list and passenger booking).
import { makeUseStyles, radius, spacing, typography } from '@kc/ui';
import {
  mainAxisAlignStart,
  rowDirectionStart,
  selfAlignStart,
  textAlignStart,
} from '../../../lib/rtlLayout';

export const useRideBookingStyles = makeUseStyles(({ colors }) => ({
  box: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignSelf: 'stretch',
    width: '100%',
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: textAlignStart(),
    alignSelf: selfAlignStart,
  },
  caption: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: textAlignStart(),
    alignSelf: selfAlignStart,
  },
  warning: {
    ...typography.caption,
    color: colors.warning,
    textAlign: textAlignStart(),
    alignSelf: selfAlignStart,
  },
  row: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignSelf: 'stretch',
    width: '100%',
  },
  name: {
    ...typography.bodyLarge,
    color: colors.textPrimary,
    textAlign: textAlignStart(),
    alignSelf: selfAlignStart,
  },
  actions: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    justifyContent: mainAxisAlignStart,
    gap: spacing.sm,
    flexWrap: 'wrap',
    alignSelf: selfAlignStart,
    width: '100%',
  },
  stepper: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.md,
    alignSelf: selfAlignStart,
  },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: { ...typography.h3, color: colors.textPrimary, minWidth: 24, textAlign: 'center' },
  stopRow: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    width: '100%',
  },
}));
