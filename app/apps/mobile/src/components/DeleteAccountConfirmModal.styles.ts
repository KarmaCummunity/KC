// Body styles of the delete-account dialog (FR-SETTINGS-012). The surface,
// title and actions come from the kit `Modal` and buttons (spec 17 §4.1).
import { makeUseStyles, radius, spacing, typography } from '@kc/ui';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';

export const useDeleteAccountConfirmModalStyles = makeUseStyles(({ colors }) => ({
  // Shrink inside the dialog's height cap so the footer stays on screen.
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: spacing.md },
  body: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  bulletList: { gap: spacing.xs },
  bullet: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  chatsRetention: {
    ...typography.body,
    ...typography.semiBold,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    backgroundColor: colors.warningLight,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  errorBanner: {
    backgroundColor: colors.errorLight,
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  errorBannerText: { ...typography.body, color: colors.error, textAlign: rtlTextAlignStart },
  errorBannerCritical: { backgroundColor: colors.error },
  errorBannerCriticalText: { ...typography.semiBold, color: colors.textInverse },
}));
