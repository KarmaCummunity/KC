// Prominent About entry on Settings — FR-SETTINGS-001 / About route.
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, iconSize, useTheme, Text } from '@kc/ui';
import { MirroredIcon } from './ui/MirroredIcon';
import { warmPromptCardBase } from './warmPromptCardStyles';

const useStyles = makeUseStyles((theme) => {
  const base = warmPromptCardBase(theme);
  const { colors, isDark } = theme;
  return {
    card: base.card,
    iconBadge: base.iconBadge,
    title: base.title,
    subtitle: base.bodyLine,
    ctaRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: spacing.xs,
      marginTop: spacing.xs,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: isDark ? colors.border : colors.primaryLight,
    },
    cta: {
      ...typography.button,
      color: colors.primary,
      ...typography.semiBold,
    },
  };
});

export function SettingsAboutCard() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push('/about')}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={t('settings.aboutCard.a11y')}
      testID="settings-about-card"
    >
      <View style={styles.iconBadge}>
        <Ionicons name="information-circle" size={iconSize['2xl']} color={colors.textInverse} />
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {t('settings.aboutCard.title')}
      </Text>
      <Text style={styles.subtitle}>{t('settings.aboutCard.subtitle')}</Text>
      <View style={styles.ctaRow}>
        <Text style={styles.cta}>{t('settings.aboutCard.cta')}</Text>
        <MirroredIcon name="chevron-forward" size={iconSize.md} color={colors.primary} />
      </View>
    </TouchableOpacity>
  );
}
