// Animated input with orange border glow on focus — RTL-ready.
import React, { useState } from 'react';
import { View, type TextInputProps } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { makeUseStyles, spacing, radius, typography, useTheme, TextInput, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface AnimatedAuthInputProps extends TextInputProps {
  label: string;
  testID?: string;
}

const useAnimatedAuthInputStyles = makeUseStyles(({ colors, isDark }) => ({
  field: { gap: spacing.xs },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
  },
  labelFocused: {
    color: colors.primary,
  },
  inputContainer: {
    height: 54,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: isDark ? 1 : 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.base,
    justifyContent: 'center' as const,
  },
  inputContainerFocused: {
    borderColor: colors.primary,
    backgroundColor: isDark ? colors.surface : colors.background,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: isDark ? 0.2 : 0.12,
    shadowRadius: 6,
    elevation: isDark ? 0 : 2,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
  },
}));

export function AnimatedAuthInput({
  label,
  onFocus,
  onBlur,
  ...rest
}: AnimatedAuthInputProps) {
  const { colors } = useTheme();
  const styles = useAnimatedAuthInputStyles();
  const [focused, setFocused] = useState(false);
  const scale = useSharedValue(1);
  const borderProgress = useSharedValue(0);

  const handleFocus = (e: Parameters<NonNullable<TextInputProps['onFocus']>>[0]) => {
    setFocused(true);
    scale.value = withTiming(1.015, { duration: 150 });
    borderProgress.value = withTiming(1, { duration: 200 });
    onFocus?.(e);
  };

  const handleBlur = (e: Parameters<NonNullable<TextInputProps['onBlur']>>[0]) => {
    setFocused(false);
    scale.value = withTiming(1, { duration: 150 });
    borderProgress.value = withTiming(0, { duration: 200 });
    onBlur?.(e);
  };

  const wrapperStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.field}>
      <Text style={[styles.label, focused && styles.labelFocused]}>{label}</Text>
      <Animated.View
        style={[
          styles.inputContainer,
          focused && styles.inputContainerFocused,
          wrapperStyle,
        ]}
      >
        <TextInput
          style={styles.input}
          placeholderTextColor={colors.textDisabled}
          textAlign={rtlTextAlignStart}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...rest}
        />
      </Animated.View>
    </View>
  );
}
