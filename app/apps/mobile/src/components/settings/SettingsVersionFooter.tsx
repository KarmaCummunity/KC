import React from 'react';
import Constants from 'expo-constants';
import type { StyleProp, TextStyle } from 'react-native';
import { Text } from '@kc/ui';
import { useTranslation } from 'react-i18next';

/** #2520: the Expo marketing version is sourced from app/VERSION at build time. */
export function SettingsVersionFooter({ style }: Readonly<{ style?: StyleProp<TextStyle> }>) {
  const { t } = useTranslation();
  const version = Constants.expoConfig?.version?.trim();
  // Never invent a version for a build that does not expose its config.
  if (!version) return null;
  return <Text style={style}>{t('settings.version')} v{version}</Text>;
}
