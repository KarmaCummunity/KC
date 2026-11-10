// Link from the home feed filter sheet to feed mute settings (FR-FEED-008 / feed settings).
import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { MirroredIcon } from '../ui/MirroredIcon';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

export function FeedSettingsLinkSection({ onPress }: { readonly onPress: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="link"
        accessibilityLabel={t('filters.feedSettingsLinkA11y')}
        testID="feed-filter-open-settings"
        style={styles.pressable}
      >
        <Ionicons name="options-outline" size={iconSize.lg} color={colors.primary} />
        <Text style={styles.label}>{t('filters.feedSettingsLink')}</Text>
        <MirroredIcon name="chevron-forward" size={iconSize.md} color={colors.textDisabled} />
      </Pressable>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: { paddingHorizontal: spacing.base, paddingTop: spacing.md, paddingBottom: spacing.sm },
  pressable: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  label: {
    ...typography.body,
    color: colors.primary,
    flex: 1,
    textAlign: rtlTextAlignStart,
    ...typography.semiBold,
  },
}));
