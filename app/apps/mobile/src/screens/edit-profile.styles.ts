import { makeUseStyles, spacing, typography } from '@kc/ui';
import { rtlTextAlignEnd } from '../lib/rtlLayout';

export const useEditProfileStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  scroll: { gap: spacing.base },
  field: { gap: spacing.xs },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  count: { ...typography.caption, color: colors.textDisabled, textAlign: rtlTextAlignEnd },
}));
