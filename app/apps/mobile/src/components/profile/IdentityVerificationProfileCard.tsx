// FR-VERIFY-003 AC1 — on the member's own profile, a reminder to complete identity verification.
import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

export function IdentityVerificationProfileCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const styles = useStyles();

  return (
    <View style={styles.wrap} testID="profile-identity-nudge">
      <View style={styles.row}>
        <Ionicons name="shield-checkmark-outline" size={iconSize.xl} color={colors.primary} />
        <View style={styles.textBlock}>
          <Text style={styles.title}>{t('verification.identity.profileNudge.title')}</Text>
          <Text style={styles.body}>{t('verification.identity.profileNudge.body')}</Text>
        </View>
      </View>
      <Pressable
        style={styles.cta}
        onPress={() => router.push('/identity-verification')}
        accessibilityRole="button"
        testID="profile-identity-nudge-cta"
      >
        <Text style={styles.ctaText}>{t('verification.identity.profileNudge.cta')}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.primarySurface,
  },
  row: { flexDirection: rowDirectionStart, alignItems: 'flex-start' as const, gap: spacing.sm },
  textBlock: { flex: 1, gap: spacing.xs },
  title: { ...typography.bodySmall, ...typography.bold, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  body: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  cta: {
    alignSelf: 'stretch' as const,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  ctaText: { ...typography.caption, ...typography.bold, color: colors.textInverse },
}));
