import { makeUseStyles, spacing, typography } from '@kc/ui';
import { rowDirectionStart } from '../lib/rtlLayout';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';

// Shared by the followers and following list screens (FR-PROFILE-010), which
// render the same search row and user rows; `menuBtn` is the followers-only
// "remove follower" control.
export const useFollowListStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.background },
  searchWrap: { paddingHorizontal: spacing.base, paddingTop: spacing.base, marginBottom: 0 },
  row: {
    flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.base, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowText: { flex: 1 },
  name: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  city: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  menuBtn: { padding: spacing.xs },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg },
}));
