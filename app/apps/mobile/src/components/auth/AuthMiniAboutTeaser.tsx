// Compact "about us" teaser for pre-signup auth surfaces (FR-AUTH-001 / FR-AUTH-018 spirit).
import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, typography, spacing, radius, shadow, iconSize, useTheme, Text } from '@kc/ui';
import { MirroredIcon } from '../ui/MirroredIcon';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const PILLARS: ReadonlyArray<{ readonly icon: IoniconName; readonly key: 'pillarFree' | 'pillarNoAds' | 'pillarNonProfit' }> = [
  { icon: 'heart-outline', key: 'pillarFree' },
  { icon: 'eye-off-outline', key: 'pillarNoAds' },
  { icon: 'leaf-outline', key: 'pillarNonProfit' },
];

export function AuthMiniAboutTeaser() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <View style={styles.card}>
      <Text style={styles.tagline}>{t('aboutContent.tagline')}</Text>
      <Text style={styles.body}>{t('onboarding.aboutIntroBody')}</Text>

      <View style={styles.pillars}>
        {PILLARS.map((p) => (
          <View key={p.key} style={styles.pillar}>
            <View style={styles.pillarIcon}>
              <Ionicons name={p.icon} size={iconSize.md} color={colors.primary} />
            </View>
            <Text style={styles.pillarLabel}>{t(`onboarding.${p.key}`)}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={styles.learnMore}
        onPress={() => router.push('/about')}
        accessibilityRole="button"
        accessibilityLabel={t('auth.welcomeAboutLearnMore')}
      >
        <Text style={styles.learnMoreText}>{t('auth.welcomeAboutLearnMore')}</Text>
        <MirroredIcon name="chevron-forward" size={iconSize.md} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    gap: spacing.sm,
    borderWidth: isDark ? 1 : 0,
    borderColor: isDark ? colors.border : 'transparent',
    ...(isDark ? {} : shadow.card),
  },
  tagline: {
    ...typography.bodyLarge,
    ...typography.semiBold,
    color: colors.primaryDark,
    textAlign: 'center',
    lineHeight: 22,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  pillars: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  pillar: { flex: 1, alignItems: 'center', gap: spacing.xs },
  pillarIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillarLabel: {
    ...typography.caption,
    color: colors.textPrimary,
    textAlign: 'center',
    ...typography.semiBold,
  },
  learnMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
  },
  learnMoreText: {
    ...typography.body,
    color: colors.primary,
    ...typography.semiBold,
  },
}));
