// Sticky guest invite on public research — FR-RESEARCH-001 AC2, FR-RESEARCH-004 AC7.
// Shown only when the visitor is not signed in; keeps the survey fully usable.
import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { webTextRtl, webViewRtl } from '../../lib/webRtlStyle';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { useAuthStore } from '../../store/authStore';

export function ResearchGuestInviteBanner(): React.JSX.Element | null {
  const { t } = useTranslation();
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  if (isLoading || isAuthenticated) return null;

  function handleSignUp() {
    router.push('/(auth)');
  }

  return (
    <View style={[styles.banner, webViewRtl]}>
      <View style={styles.textCol}>
        <Text style={styles.kicker}>{t('research.guestInvite.kicker')}</Text>
        <Text style={styles.title}>{t('research.guestInvite.title')}</Text>
        <Text style={styles.body}>{t('research.guestInvite.body')}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        onPress={handleSignUp}
        accessibilityRole="button"
        accessibilityLabel={t('research.guestInvite.signUpCta')}
      >
        <Text style={styles.ctaText}>{t('research.guestInvite.signUpCta')}</Text>
        <Ionicons name="arrow-back" size={16} color={colors.textInverse} />
      </Pressable>
      <Text style={styles.finePrint}>{t('research.guestInvite.finePrint')}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  banner: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    padding: spacing.base,
    borderRadius: 14,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  textCol: { gap: spacing.xs },
  kicker: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  body: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    lineHeight: 20,
    ...webTextRtl,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: {
    ...typography.button,
    color: colors.textInverse,
    fontWeight: '700',
    ...webTextRtl,
  },
  finePrint: {
    ...typography.caption,
    color: colors.textDisabled,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
}));
