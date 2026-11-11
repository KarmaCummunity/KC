// FR-VERIFY-013 AC2 — main-feed card inviting the member to complete their profile.
import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { Card } from './ui/Card';
import { rowDirectionStart } from '../lib/rtlLayout';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';

export function CompleteProfileBanner({ onDismiss }: { readonly onDismiss: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const styles = useStyles();

  return (
    <View style={styles.outer} testID="complete-profile-banner">
      <Card padding="sm" style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="person-circle-outline" size={iconSize.xl} color={colors.primary} />
          <View style={styles.textBlock}>
            <Text style={styles.title}>{t('verification.nudge.title')}</Text>
            <Text style={styles.body}>{t('verification.nudge.body')}</Text>
          </View>
          <Pressable
            onPress={onDismiss}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('verification.nudge.dismiss')}
            testID="complete-profile-banner-dismiss"
          >
            <Ionicons name="close" size={iconSize.md} color={colors.textSecondary} />
          </Pressable>
        </View>
        <Pressable
          style={styles.cta}
          onPress={() => router.push('/edit-profile')}
          accessibilityRole="button"
          testID="complete-profile-banner-cta"
        >
          <Text style={styles.ctaText}>{t('verification.nudge.cta')}</Text>
        </Pressable>
      </Card>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  outer: { marginHorizontal: spacing.base, marginBottom: spacing.sm, marginTop: spacing.xs },
  card: { gap: spacing.sm },
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
