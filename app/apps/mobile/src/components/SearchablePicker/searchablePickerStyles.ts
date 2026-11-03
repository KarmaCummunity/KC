import { makeUseStyles, radius, spacing, typography } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlLayout';

/** Smallest body height of the picker sheet, in points (search field + a few rows). */
const SHEET_CONTENT_MIN_HEIGHT = 240;

export const useSearchablePickerStyles = makeUseStyles(({ colors, isDark }) => ({
  field: {
    height: 50,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: isDark ? 1 : 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.base,
    justifyContent: 'center' as const,
  },
  fieldDisabled: { opacity: 0.5 },
  disabledHelper: {
    ...typography.label,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    marginTop: spacing.xs,
  },
  value: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  valuePlaceholder: { color: colors.textDisabled },
  // The kit BottomSheet is content-sized (capped by `maxHeight`), so `flex: 1` here resolves
  // against an indefinite height and collapses the list to ~0 (only the first row showed).
  // `flexShrink` lets the list fill up to the cap; `minHeight` keeps the sheet from jumping
  // in size while a search narrows the results to a few rows.
  sheetContent: { flexShrink: 1, minHeight: SHEET_CONTENT_MIN_HEIGHT },
  search: { marginBottom: spacing.sm },
  statusRow: { paddingVertical: spacing.lg, alignItems: 'center' as const },
  errorBlock: { alignItems: 'center' as const, paddingVertical: spacing.md },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center' as const,
    paddingVertical: spacing.sm,
  },
  retryButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primarySurface,
  },
  retryLabel: {
    ...typography.body,
    color: colors.primary,
    ...typography.semiBold,
    textAlign: 'center' as const,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    paddingVertical: spacing.lg,
  },
  row: {
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowText: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  freeTextRow: { backgroundColor: colors.primarySurface },
  freeTextLabel: {
    ...typography.body,
    color: colors.primary,
    textAlign: rtlTextAlignStart,
    ...typography.semiBold,
  },
}));
