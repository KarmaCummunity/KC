// Mapped to spec: FR-FEED-003 / FR-FEED-004 (search bar for filter sheets and kits)
import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, iconSize, radius, spacing, typography, useTheme, TextInput } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

export interface FilterSearchBarProps {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly placeholder?: string;
  readonly accessibilityLabel?: string;
  readonly clearAccessibilityLabel?: string;
  readonly testID?: string;
}

export function FilterSearchBar({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  clearAccessibilityLabel,
  testID,
}: FilterSearchBarProps) {
  const { t } = useTranslation();
  const styles = useFilterSearchBarStyles();
  const { colors } = useTheme();
  const resolvedPlaceholder = placeholder ?? t('filters.searchPlaceholder');

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.inputRow}>
        <Ionicons name="search" size={iconSize.md} color={colors.textSecondary} />
        <TextInput // brand-guard-allow: search bar input, not a form field
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={resolvedPlaceholder}
          placeholderTextColor={colors.textSecondary}
          textAlign={rtlTextAlignStart}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={accessibilityLabel ?? resolvedPlaceholder}
        />
        {value.length > 0 && (
          <Pressable
            onPress={() => onChangeText('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={clearAccessibilityLabel ?? t('filters.searchClearA11y')}
          >
            <Ionicons name="close-circle" size={iconSize.md} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const useFilterSearchBarStyles = makeUseStyles(({ colors }) => ({
  wrap: { marginBottom: spacing.md },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: spacing.xs,
  },
}));
