// Edit-post screen styles — tokens only (spec 17 §4/§6, D67). Chips live in
// FilterChipRow / kit Chip; street address uses StreetAddressRow. Keep every
// key here referenced by app/edit-post or EditPostFormScrollContent (#2386).
import { makeUseStyles, radius, spacing, typography } from '@kc/ui';
import { rtlTextAlignEnd } from '../../lib/rtlTextAlignStart';

export const useEditPostScreenStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.base },
  errorTitle: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' as const },
  retryBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  retryText: { ...typography.button, color: colors.textInverse },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerClose: { padding: spacing.xs },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    minWidth: 60,
    alignItems: 'center',
  },
  saveBtnText: { ...typography.button, color: colors.textInverse },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.base, gap: spacing.base, paddingBottom: spacing['3xl'] },
  typeBadge: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: radius.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  typeBadgeGive: { backgroundColor: colors.giveTagBg },
  typeBadgeRequest: { backgroundColor: colors.requestTagBg },
  typeBadgeText: { ...typography.button, color: colors.textPrimary },
  typeBadgeSub: { ...typography.caption, color: colors.textSecondary },
  // End edge so the counter sits opposite the field label in both RTL and LTR.
  charCount: { ...typography.caption, color: colors.textDisabled, textAlign: rtlTextAlignEnd },
}));
