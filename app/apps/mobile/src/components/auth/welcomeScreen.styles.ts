import { Platform, type ViewStyle } from 'react-native';
import { makeUseStyles, radius, shadow, spacing, typography } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { isLayoutRtl } from '../../lib/rtlLayout';

/**
 * Trailing-edge inset for the absolutely-positioned auth-button icon.
 * Native auto-mirrors `end`; RN-Web ignores `start`/`end` for absolute
 * positioning, so on web we resolve RTL live and emit a physical key.
 */
function authBtnIconCornerEnd(): Pick<ViewStyle, 'left' | 'right' | 'end'> {
  if (Platform.OS !== 'web') return { end: spacing.lg };
  return isLayoutRtl() ? { left: spacing.lg } : { right: spacing.lg };
}

// Welcome / sign-in entry styles — theme-aware so the warm cream/white surfaces
// flip to warm-dark counterparts in dark mode.
export const useWelcomeScreenStyles = makeUseStyles(({ colors, isDark }) => ({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceCream,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing['3xl'],
  },
  languageToggle: {
    alignSelf: 'flex-end' as const,
    marginTop: spacing.md,
  },

  // ── Hero ──────────────────────────────────────────────────────────────
  hero: {
    alignItems: 'center' as const,
    paddingTop: spacing['4xl'],
    paddingBottom: spacing['2xl'],
  },
  logoRingWrapper: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: spacing.lg,
  },
  logoRing: {
    position: 'absolute' as const,
    width: 148,
    height: 148,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  logo: {
    width: 108,
    height: 108,
    borderRadius: radius.xl,
  },
  appName: {
    ...typography.h1,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    letterSpacing: -0.5,
  },
  tagline: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },

  // ── Value props ───────────────────────────────────────────────────────
  valueProps: {
    marginBottom: spacing.lg,
    gap: spacing.base,
  },
  miniAboutWrap: {
    marginBottom: spacing['2xl'],
  },
  valuePropRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderWidth: isDark ? 1 : 0,
    borderColor: isDark ? colors.border : 'transparent',
    ...(isDark ? {} : shadow.card),
  },
  valuePropIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySurface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  valuePropText: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    textAlign: rtlTextAlignStart,
    ...typography.medium,
  },

  // ── Buttons ───────────────────────────────────────────────────────────
  buttons: {
    gap: spacing.sm,
  },
  authBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    height: 56,
    borderRadius: radius.xl,
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  authBtnIconWrap: {
    position: 'absolute' as const,
    ...authBtnIconCornerEnd(),
    width: 24,
    height: 24,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  authBtnText: {
    ...typography.button,
    ...typography.bodyLarge,
    ...typography.semiBold,
    textAlign: 'center' as const,
  },
  authBtnDisabled: { opacity: 0.6 },
  socialButtons: { gap: spacing.sm },

  // Google: surface card with hairline (matches surface in both modes)
  googleBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    ...(isDark ? {} : shadow.card),
  },
  googleBtnText: { color: colors.textPrimary },
  googleGLetter: {
    ...typography.h3,
    ...typography.bold,
    // Google blue stays the same in both modes — brand-locked.
    color: '#4285F4', // brand-guard-allow: Google brand mark color
  },

  // Apple: brand-locked black; on dark mode invert so it doesn't disappear.
  appleBtn: { backgroundColor: isDark ? '#FFFFFF' : '#000000' }, // brand-guard-allow: Apple brand button colors
  appleBtnText: { color: isDark ? '#000000' : '#FFFFFF' }, // brand-guard-allow: Apple brand button colors

  // Tertiary text link under the sign-in buttons (email entry).
  textLinkBtn: {
    marginTop: spacing.xs,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  emailEntryText: {
    ...typography.body,
    color: colors.primary,
    textDecorationLine: 'underline' as const,
  },

  oauthDividerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    marginVertical: spacing.lg,
  },
  oauthDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  oauthDividerText: {
    ...typography.caption,
    color: colors.textSecondary,
  },

  // ── Legal ─────────────────────────────────────────────────────────────
  legal: {
    ...typography.caption,
    color: colors.textDisabled,
    textAlign: 'center' as const,
    marginTop: spacing.xl,
    lineHeight: 18,
  },
}));
