import React from 'react';
import Constants from 'expo-constants';
import type { StyleProp, TextStyle } from 'react-native';
import { Text } from '@kc/ui';
import { useTranslation } from 'react-i18next';

/**
 * #2520: the Expo marketing version is sourced from app/VERSION at build time.
 * #2613: app/VERSION moves only at release time, so dev builds also show the
 * commit (`extra.gitCommitSha`, 7 hex chars from app.config.ts): v1.9.x+sha7.
 */
export function formatAppVersion(version: string | undefined, sha: unknown): string | null {
  const v = version?.trim();
  // Never invent a version for a build that does not expose its config.
  if (!v) return null;
  const s = typeof sha === 'string' ? sha.trim().toLowerCase() : '';
  return /^[0-9a-f]{7}$/.test(s) ? `v${v}+${s}` : `v${v}`;
}

export function SettingsVersionFooter({ style }: Readonly<{ style?: StyleProp<TextStyle> }>) {
  const { t } = useTranslation();
  const label = formatAppVersion(Constants.expoConfig?.version, Constants.expoConfig?.extra?.gitCommitSha);
  if (!label) return null;
  return <Text style={style}>{t('settings.version')} {label}</Text>;
}
