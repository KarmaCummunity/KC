// Settings → Appearance screen — FR-SETTINGS-014.
//
// Three-mode picker (System / Light / Dark) plus a live preview card so the
// user can see the palette before committing. Mode is persisted by
// `themeStore` and resolved against the OS scheme in AppThemeProvider.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  darkColors,
  lightColors,
  makeUseStyles,
  radius,
  spacing,
  typography,
  useTheme,
  Text,
} from '@kc/ui';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { ModeRow, PalettePreview, type ModeOption } from '../../src/components/settings/appearanceParts';

const MODE_OPTIONS: readonly ModeOption[] = [
  {
    mode: 'system',
    icon: 'phone-portrait-outline',
    labelKey: 'settings.appearanceScreen.modeSystemLabel',
    hintKey: 'settings.appearanceScreen.modeSystemHint',
  },
  {
    mode: 'light',
    icon: 'sunny-outline',
    labelKey: 'settings.appearanceScreen.modeLightLabel',
    hintKey: 'settings.appearanceScreen.modeLightHint',
  },
  {
    mode: 'dark',
    icon: 'moon-outline',
    labelKey: 'settings.appearanceScreen.modeDarkLabel',
    hintKey: 'settings.appearanceScreen.modeDarkHint',
  },
] as const;

export default function AppearanceScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const { t } = useTranslation();
  const { mode, setMode, colors } = useTheme();
  const styles = useScreenStyles();

  return (
    <>
      <Stack.Screen
        options={{
          ...shellStackScreenOptions,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitle: t('settings.appearanceScreen.title'),
        }}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={styles.intro}>{t('settings.appearanceScreen.intro')}</Text>

        <Text style={styles.sectionLabel}>
          {t('settings.appearanceScreen.sectionMode')}
        </Text>
        <View style={styles.optionGroup}>
          {MODE_OPTIONS.map((opt) => (
            <ModeRow
              key={opt.mode}
              selected={mode === opt.mode}
              option={opt}
              onSelect={() => setMode(opt.mode)}
            />
          ))}
        </View>

        <Text style={styles.sectionLabel}>
          {t('settings.appearanceScreen.previewLabel')}
        </Text>
        <View style={styles.previewRow}>
          <PalettePreview
            palette={lightColors}
            labelKey="settings.appearanceScreen.modeLightLabel"
          />
          <PalettePreview
            palette={darkColors}
            labelKey="settings.appearanceScreen.modeDarkLabel"
          />
        </View>
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
  sectionLabel: {
    ...typography.label,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
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
  previewRow: {
    flexDirection: 'row' as const,
    gap: spacing.md,
    ...webViewRtl,
  },
}));
