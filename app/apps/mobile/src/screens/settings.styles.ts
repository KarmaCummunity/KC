import { makeUseStyles, spacing, typography } from '@kc/ui';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../lib/webRtlStyle';

// Settings screen styles — themed via `makeUseStyles` so they respond to
// FR-SETTINGS-014 (dark mode toggle).
export const useSettingsScreenStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.background, ...webViewRtl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...webViewRtl,
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  scrollContent: { paddingBottom: spacing.xl * 2, ...webViewRtl },
  sectionTitle: {
    ...typography.label,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.xs,
    width: '100%',
    ...webTextRtl,
  },
  section: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    ...webViewRtl,
  },
  version: { ...typography.caption, color: colors.textDisabled, textAlign: 'center' as const, padding: spacing.xl },
  supportCardWrap: { paddingHorizontal: spacing.base, paddingTop: spacing.base },
}));
