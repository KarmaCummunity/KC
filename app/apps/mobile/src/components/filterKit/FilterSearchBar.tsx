// Mapped to spec: FR-FEED-003 / FR-FEED-004 (search bar for filter sheets and kits)
import React from 'react';
import { Pressable, View, type StyleProp, type TextStyle, type ViewStyle, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, iconSize, radius, spacing, typography, useTheme, TextInput } from '@kc/ui';
import { emptyInputDirectionStyle } from '../../lib/rtlLayout';

export interface FilterSearchBarProps {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly placeholder?: string;
  readonly accessibilityLabel?: string;
  readonly clearAccessibilityLabel?: string;
  readonly testID?: string;
  readonly onSubmitEditing?: () => void;
  readonly returnKeyType?: TextInputProps['returnKeyType'];
  readonly autoCorrect?: boolean;
  readonly autoCapitalize?: TextInputProps['autoCapitalize'];
  readonly style?: StyleProp<ViewStyle>;
  readonly inputRowStyle?: StyleProp<ViewStyle>;
  readonly inputStyle?: StyleProp<TextStyle>;
  readonly onClear?: () => void;
  readonly inputRef?: React.Ref<React.ComponentRef<typeof TextInput>>;
}

export function FilterSearchBar({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  clearAccessibilityLabel,
  testID,
  onSubmitEditing,
  returnKeyType = 'search',
  autoCorrect = false,
  autoCapitalize,
  style,
  inputRowStyle,
  inputStyle,
  onClear,
  inputRef,
}: FilterSearchBarProps) {
  const { t } = useTranslation();
  const styles = useFilterSearchBarStyles();
  const { colors } = useTheme();
  const resolvedPlaceholder = placeholder ?? t('filters.searchPlaceholder');

  const handleClear = () => {
    onChangeText('');
    onClear?.();
  };

  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.inputRow, inputRowStyle]}>
        <Ionicons name="search" size={iconSize.md} color={colors.textSecondary} />
        <TextInput // brand-guard-allow: search bar input, not a form field
          ref={inputRef}
          testID={testID}
          style={[styles.input, value.length === 0 ? emptyInputDirectionStyle() : null, inputStyle]}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          placeholder={resolvedPlaceholder}
          placeholderTextColor={colors.textSecondary}
          autoCorrect={autoCorrect}
          autoCapitalize={autoCapitalize}
          returnKeyType={returnKeyType}
          accessibilityLabel={accessibilityLabel ?? resolvedPlaceholder}
        />
        {value.length > 0 && (
          <Pressable
            onPress={handleClear}
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
    // FR-RESP-006 AC21 — Hebrew / English queries follow typed content.
    textAlign: 'auto',
    writingDirection: 'auto',
  },
}));
