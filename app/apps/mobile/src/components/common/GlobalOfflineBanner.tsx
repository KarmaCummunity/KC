import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, iconSize, Text } from '@kc/ui';
import { useNetworkStatus } from '../../lib/networkStatusStore';

export function GlobalOfflineBanner() {
  const { isOnline } = useNetworkStatus();
  const { t } = useTranslation();

  if (isOnline) {
    return null;
  }

  return (
    <View
      style={styles.container}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="global-offline-banner"
    >
      <Ionicons
        name="cloud-offline-outline"
        size={iconSize.sm}
        color={colors.warning}
        style={styles.icon}
      />
      <Text style={styles.text}>{t('offlineSync.banner')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.warning,
    borderBottomWidth: 1,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginEnd: spacing.xs,
  },
  text: {
    ...typography.caption,
    color: colors.textPrimary,
  },
});
