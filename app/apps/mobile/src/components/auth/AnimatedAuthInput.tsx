// Animated input with orange border glow on focus — RTL-ready. Shows its validation message under the
// field like the kit `TextField` (FR-RESP-006 AC29), so the form scope can jump to it.
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { View, type TextInputProps } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { makeUseStyles, spacing, radius, typography, shadow, useTheme, TextInput, Text, type TextInput as UiTextInput } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { inputTextAlignStart } from '../../lib/rtlLayout';
import { useFormScopeField } from '../ui/useFormScopeField';
import { formInputKindProps, type FormInputKind } from '../../lib/platform/formTextInputHints';
import { FieldMessage } from '../ui/FieldMessage';

interface AnimatedAuthInputProps extends TextInputProps {
  label: string;
  testID?: string;
  /** What the field holds; picks the matching keyboard and autofill hints (explicit props still win). */
  inputKind?: FormInputKind;
  /** Validation message: the field turns red and shows it underneath. */
  errorText?: string;
}

const AuthFieldInput = TextInput;

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
  inputContainerError: { borderColor: colors.error },
  inputContainerFocused: {
    borderColor: colors.primary,
    backgroundColor: isDark ? colors.surface : colors.background,
    ...(isDark ? {} : shadow.card),
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
  },
}));

export const AnimatedAuthInput = forwardRef<UiTextInput, AnimatedAuthInputProps>(function AnimatedAuthInput(
  {
    label,
    onFocus,
    onBlur,
    onSubmitEditing,
    inputKind = 'text',
    errorText,
    ...rest
  },
  ref,
) {
  const inputRef = useRef<UiTextInput>(null);
  const fieldRef = useRef<View>(null);
  // Callers keep getting the native input; the form scope reads it through the same ref.
  useImperativeHandle(ref, () => inputRef.current as UiTextInput);
  const scope = useFormScopeField({
    inputRef,
    viewRef: fieldRef,
    editable: rest.editable !== false,
    multiline: rest.multiline === true,
    hasError: Boolean(errorText),
  });
  const { colors } = useTheme();
  const styles = useAnimatedAuthInputStyles();
  const [focused, setFocused] = useState(false);
  const scale = useSharedValue(1);
  const borderProgress = useSharedValue(0);

  const handleFocus = (e: Parameters<NonNullable<TextInputProps['onFocus']>>[0]) => {
    setFocused(true);
    scope.onFocus();
    scale.value = withTiming(1.015, { duration: 150 });
    borderProgress.value = withTiming(1, { duration: 200 });
    onFocus?.(e);
  };

  const handleBlur = (e: Parameters<NonNullable<TextInputProps['onBlur']>>[0]) => {
    setFocused(false);
    scope.onBlur();
    scale.value = withTiming(1, { duration: 150 });
    borderProgress.value = withTiming(0, { duration: 200 });
    onBlur?.(e);
  };

  const wrapperStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View ref={fieldRef} collapsable={false} style={styles.field}>
      <Text style={[styles.label, focused && styles.labelFocused]}>{label}</Text>
      <Animated.View
        style={[
          styles.inputContainer,
          focused && styles.inputContainerFocused,
          errorText ? styles.inputContainerError : null,
          wrapperStyle,
        ]}
      >
        <AuthFieldInput
          ref={inputRef}
          style={styles.input}
          placeholderTextColor={colors.textDisabled}
          textAlign={inputTextAlignStart()}
          // The label is the input's name; a shown error is read with it.
          accessibilityLabel={errorText ? `${label}, ${errorText}` : label}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...formInputKindProps[inputKind]}
          {...scope.inputProps}
          {...rest}
          onSubmitEditing={(e) => {
            onSubmitEditing?.(e);
            scope.onSubmitEditing();
          }}
        />
      </Animated.View>
      <FieldMessage errorText={errorText} />
    </View>
  );
});
