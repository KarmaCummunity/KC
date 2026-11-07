// Pre-sign-in UI language switch — FR-SETTINGS-018 (exposed on the auth screens).
//
// Shows the *other* supported language in its own script, so a visitor who cannot
// read the current UI still recognises it. Applies the same persist → change →
// direction → reload flow as Settings → App language.
import React from 'react';
import { ActivityIndicator, Alert, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { applyLayoutDirection, persistLanguage, reloadApp, type AppLanguage } from '../../i18n/language';

const LABEL_KEY: Record<AppLanguage, string> = {
  he: 'settings.languageScreen.optionHe',
  en: 'settings.languageScreen.optionEn',
};

export function AuthLanguageToggle({ style }: Readonly<{ style?: StyleProp<ViewStyle> }>) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const [switching, setSwitching] = React.useState(false);
  const next: AppLanguage = i18n.language === 'en' ? 'he' : 'en';

  const onPress = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      await persistLanguage(next);
      await i18n.changeLanguage(next);
      applyLayoutDirection(next);
      reloadApp();
    } catch {
      setSwitching(false);
      Alert.alert(t('general.error'), t('settings.languageScreen.saveFailed'));
    }
  };

  return (
    <TouchableOpacity
      testID="auth-language-toggle"
      style={[styles.pill, style]}
      onPress={onPress}
      disabled={switching}
      accessibilityRole="button"
      accessibilityLabel={t('settings.languageScreen.switchA11y')}
    >
      {switching ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons name="globe-outline" size={iconSize.sm} color={colors.primary} />
      )}
      <Text style={styles.label}>{t(LABEL_KEY[next])}</Text>
    </TouchableOpacity>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  pill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  label: { ...typography.caption, ...typography.semiBold, color: colors.primary },
}));
