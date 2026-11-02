// Shared layout for the auth link screens: the FR-AUTH-008 forms
// (`(auth)/forgot-password`, `auth/reset-password`) and the status states in
// `AuthStatusScreen` (`auth/verify`, `auth/callback`).
import { makeUseStyles, spacing, typography } from '@kc/ui';

export const usePasswordResetStyles = makeUseStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center' as const,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.md,
    width: '100%' as const,
    maxWidth: 480,
    alignSelf: 'center' as const,
  },
  centered: { alignItems: 'center' as const },
  title: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' as const },
  body: { ...typography.body, color: colors.textSecondary, textAlign: 'center' as const },
  error: { ...typography.caption, color: colors.error, textAlign: 'center' as const },
}));
