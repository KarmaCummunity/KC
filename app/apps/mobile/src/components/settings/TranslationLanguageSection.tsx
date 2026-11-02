// FR-TRANSLATE-003 — settings entry for the UGC translation language; hidden while
// the `ugc_auto_translation` flag is off.
import React from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import { SettingsScreenRow } from '../SettingsScreenRow';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';

interface Props {
  titleStyle: StyleProp<TextStyle>;
  sectionStyle: StyleProp<ViewStyle>;
}

export function TranslationLanguageSection({ titleStyle, sectionStyle }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFeatureFlag('ugc_auto_translation');
  if (!enabled) return null;
  return (
    <>
      <Text style={titleStyle}>{t('settings.translationLanguage')}</Text>
      <View style={sectionStyle}>
        <SettingsScreenRow
          label={t('settings.translationLanguage')}
          icon="language-outline"
          onPress={() => router.push('/settings/translation-language')}
        />
      </View>
    </>
  );
}
