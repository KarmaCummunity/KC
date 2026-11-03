// Shared chip look for the listing create form's pickers (listing kind, world subcategory,
// add-photo), so every chip row on the form stays identical.
import { makeUseStyles, radius, spacing, typography } from '@kc/ui';

export const useListingChipStyles = makeUseStyles(({ colors }) => ({
  chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  chipText: { ...typography.caption, color: colors.textPrimary },
}));
