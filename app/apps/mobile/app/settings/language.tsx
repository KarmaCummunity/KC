// Settings → App language screen — FR-SETTINGS-018.
//
// Picks the app UI locale (Hebrew ↔ English). The choice is persisted locally and
// applied by reloading the app so the layout direction (RTL/LTR) re-resolves.
// Distinct from FR-TRANSLATE-003 (translation language for user-generated content).
import React from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import i18n from '../../src/i18n';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { LanguageRow } from '../../src/components/settings/translationLanguageParts';
import {
  SUPPORTED_APP_LANGUAGES,
  applyLayoutDirection,
  persistLanguage,
  reloadApp,
  type AppLanguage,
} from '../../src/i18n/language';

// Language options are labelled in their own script (native names live in the i18n
// bundles under identical keys, so the label is the same regardless of active UI
// language) — a user who cannot read the current UI still recognises their language.
const LABEL_KEY: Record<AppLanguage, string> = {
  he: 'settings.languageScreen.optionHe',
  en: 'settings.languageScreen.optionEn',
};

export default function AppLanguageScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useScreenStyles();
  const [switching, setSwitching] = React.useState(false);
  const current: AppLanguage = i18n.language === 'en' ? 'en' : 'he';

  const onPick = React.useCallback(
    async (lang: AppLanguage) => {
      if (lang === current || switching) return;
      setSwitching(true);
      try {
        await persistLanguage(lang);
        await i18n.changeLanguage(lang);
        applyLayoutDirection(lang);
        reloadApp();
      } catch {
        setSwitching(false);
        Alert.alert(t('general.error'), t('settings.languageScreen.saveFailed'));
      }
    },
    [current, switching, t],
  );

  return (
    <>
      <Stack.Screen
        options={{
          ...shellStackScreenOptions,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitle: t('settings.languageScreen.title'),
        }}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.intro}>{t('settings.languageScreen.intro')}</Text>
        <View style={styles.optionGroup}>
          {SUPPORTED_APP_LANGUAGES.map((lang) => (
            <LanguageRow
              key={lang}
              label={t(LABEL_KEY[lang])}
              selected={current === lang}
              disabled={switching}
              onSelect={() => onPick(lang)}
            />
          ))}
        </View>
        <Text style={styles.note}>{t('settings.languageScreen.restartNote')}</Text>
      </ScrollView>
    </>
  );
}

const useScreenStyles = makeUseStyles(({ colors }) => ({
  scroll: { flex: 1, backgroundColor: colors.background, ...webViewRtl },
  scrollContent: {
    padding: spacing.base,
    paddingBottom: spacing['3xl'],
    ...webViewRtl,
  },
  intro: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    marginBottom: spacing.lg,
    width: '100%',
    ...webTextRtl,
  },
  optionGroup: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden' as const,
    ...webViewRtl,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    marginTop: spacing.md,
    width: '100%',
    ...webTextRtl,
  },
}));
