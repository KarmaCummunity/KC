import { makeUseStyles, radius, spacing, typography } from '@kc/ui';
import { rtlTextAlignEnd } from '../lib/rtlLayout';

export const useEditProfileStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  scroll: { padding: spacing.lg, gap: spacing.base, paddingBottom: spacing['3xl'] },
  field: { gap: spacing.xs },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  count: { ...typography.caption, color: colors.textDisabled, textAlign: rtlTextAlignEnd },
  saveBtn: {
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.base,
  },
  saveText: { ...typography.button, color: colors.textInverse },
}));
