// Mapped to spec: FR-FEED-004 (filter modal entry button with active-filter count badge)
import React from 'react';
import { Platform, TouchableOpacity, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, iconSize, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { isLayoutRtl } from '../../lib/rtlLayout';

function badgeCornerEnd(): Pick<ViewStyle, 'left' | 'right' | 'end'> {
  if (Platform.OS !== 'web') return { end: 0 };
  return isLayoutRtl() ? { left: 0 } : { right: 0 };
}

export interface FilterButtonProps {
  readonly activeCount: number;
  readonly onPress: () => void;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

export function FilterButton({
  activeCount,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: FilterButtonProps) {
  const styles = useFilterButtonStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const display = activeCount > 9 ? '9+' : String(activeCount);

  return (
    <TouchableOpacity
      style={styles.btn}
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? t('feed.filterA11y')}
      accessibilityHint={accessibilityHint ?? t('feed.filterA11yHint')}
    >
      <Ionicons name="options-outline" size={iconSize['2xl']} color={colors.textPrimary} />
      {activeCount > 0 && (
        <View style={styles.badge} testID="filter-button-badge">
          <Text style={styles.badgeText}>{display}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const useFilterButtonStyles = makeUseStyles(({ colors }) => ({
  btn: { padding: spacing.xs, position: 'relative' as const },
  badge: {
    position: 'absolute' as const,
    top: 0,
    ...badgeCornerEnd(),
    backgroundColor: colors.error,
    borderRadius: radius.full,
    minWidth: 18,
    height: 18,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  badgeText: { ...typography.caption, ...typography.bold, color: colors.textInverse },
}));
