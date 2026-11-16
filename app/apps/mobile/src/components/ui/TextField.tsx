// Shared text field — the one input look for every form (spec 17 §4.1, issue #1283).
//
//   <TextField label="..." helperText="..." errorText={err} leadingIcon="mail-outline" ... />
//
// Anatomy (top → bottom):
//   - label            typography.label in textSecondary, on the reading-start edge
//   - field            surface fill, 1px border, radius.md, min-height 48
//                      [leading icon on the start side] [brand TextInput]
//   - helper / error   typography.bodySmall; the error replaces the helper
//
// States: focused (primary border), error (error border + message), disabled
// (`editable={false}`: muted fill, textDisabled), multiline (taller, text on top).
// The border width never changes between states, so focus causes no layout shift.
//
// Inside a `FormScreen` every field joins the form scope automatically: keyboard Next / Done follows
// the on-screen order, and a field that newly shows an error is scrolled into view.
//
// Typed text follows its own direction (FR-RESP-006 AC21): Hebrew reads from
// the right, an English e-mail from the left, inside the same RTL form.
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, radius, spacing, typography, useTheme, Text, TextInput, type ColorPalette } from '@kc/ui';
import { emptyInputDirectionStyle } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { formInputKindProps, type FormInputKind } from '../../lib/platform/formTextInputHints';
import { useFormScopeField } from './useFormScopeField';

/** Ionicons glyph size inside the field and next to the error message. */
const FIELD_ICON_SIZE = 20;
const MESSAGE_ICON_SIZE = 14;

/** Web only: the border colour is the focus indicator, so drop the browser's focus ring. */
const WEB_NO_FOCUS_RING: TextStyle =
  Platform.OS === 'web' ? { outlineStyle: 'solid', outlineWidth: 0 } : {};

/** Icon tint for the field state. Error wins over focus: it stays red while the user fixes the value. */
function fieldAccentColor(colors: ColorPalette, hasError: boolean, focused: boolean): string {
  if (hasError) return colors.error;
  return focused ? colors.primary : colors.textSecondary;
}

type FocusEvent = Parameters<NonNullable<TextInputProps['onFocus']>>[0];
type BlurEvent = Parameters<NonNullable<TextInputProps['onBlur']>>[0];

/**
 * Whether the input currently holds text, for controlled (`value`) and
 * uncontrolled (`defaultValue`) use alike. Wraps `onChangeText` to keep track.
 */
function useHasText({ value, defaultValue, onChangeText }: TextInputProps) {
  const [typed, setTyped] = useState(defaultValue ?? '');
  const handleChangeText = (text: string) => {
    setTyped(text);
    onChangeText?.(text);
  };
  return { hasText: (value ?? typed).length > 0, handleChangeText };
}

export interface TextFieldProps extends TextInputProps {
  /** Visible label above the field; also the screen-reader name of the input. */
  readonly label: string;
  /** Hide the visible label (the placeholder carries it); it stays the screen-reader name. */
  readonly hideLabel?: boolean;
  /** Guidance below the field; read as the accessibility hint. */
  readonly helperText?: string;
  /** Validation message. When set the field shows its error state and hides the helper. */
  readonly errorText?: string;
  /**
   * What the field holds; picks the matching keyboard (numbers, e-mail, phone, dates…) and autofill
   * hints. Explicit `TextInput` props still win over the kind's defaults.
   */
  readonly inputKind?: FormInputKind;
  /** Ionicons glyph on the start side of the field (right in Hebrew). */
  readonly leadingIcon?: keyof typeof Ionicons.glyphMap;
  /** Outer wrapper style (margins, width). `style` still targets the text input. */
  readonly containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Labelled text input in the brand style. Pass-through `TextInputProps` go to
 * the inner `@kc/ui` TextInput, and the forwarded ref is that native input.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    hideLabel,
    helperText,
    errorText,
    leadingIcon,
    inputKind = 'text',
    containerStyle,
    style,
    accessibilityLabel,
    onFocus,
    onBlur,
    onChangeText,
    onSubmitEditing,
    ...inputProps
  },
  ref,
) {
  const styles = useTextFieldStyles();
  const { colors } = useTheme();
  const inputRef = useRef<TextInput>(null);
  // Callers get the native input itself (focus(), blur(), clear()).
  useImperativeHandle(ref, () => inputRef.current as TextInput);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<View>(null);
  const scopeProps = useFormScopeField({
    inputRef,
    viewRef: containerRef,
    editable: inputProps.editable !== false,
    hasError: Boolean(errorText),
    multiline: Boolean(inputProps.multiline),
  });
  const { hasText, handleChangeText } = useHasText({ ...inputProps, onChangeText });

  const disabled = inputProps.editable === false;
  const hasError = Boolean(errorText);
  const multiline = Boolean(inputProps.multiline);
  const baseAccessibilityLabel = accessibilityLabel ?? label;
  const inputAccessibilityLabel = hasError ? `${baseAccessibilityLabel}, ${errorText}` : baseAccessibilityLabel;
  const accentColor = fieldAccentColor(colors, hasError, focused);

  const handleFocus = (e: FocusEvent) => {
    setFocused(true);
    scopeProps.onFocus();
    onFocus?.(e);
  };
  const handleBlur = (e: BlurEvent) => {
    setFocused(false);
    scopeProps.onBlur();
    onBlur?.(e);
  };
  const handleSubmitEditing: TextInputProps['onSubmitEditing'] = (e) => {
    onSubmitEditing?.(e);
    scopeProps.onSubmitEditing();
  };

  return (
    <View ref={containerRef} collapsable={false} style={[styles.container, containerStyle]}>
      {/* Hidden from screen readers: the input below announces the label itself. */}
      {hideLabel ? null : (
        <Text style={styles.label} aria-hidden>
          {label}
        </Text>
      )}
      {/* The whole box is the tap target, so a tap on the icon still focuses the input. */}
      <Pressable
        accessible={false}
        disabled={disabled}
        onPress={() => inputRef.current?.focus()}
        style={[
          styles.field,
          multiline && styles.fieldMultiline,
          focused && styles.fieldFocused,
          hasError && styles.fieldError,
          disabled && styles.fieldDisabled,
        ]}
      >
        {leadingIcon ? (
          <Ionicons
            name={leadingIcon}
            size={FIELD_ICON_SIZE}
            color={disabled ? colors.textDisabled : accentColor}
            style={multiline ? styles.iconMultiline : undefined}
          />
        ) : null}
        <TextInput
          ref={inputRef}
          placeholderTextColor={colors.textSecondary}
          {...formInputKindProps[inputKind]}
          {...scopeProps.inputProps}
          {...inputProps}
          onChangeText={handleChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onSubmitEditing={handleSubmitEditing}
          // aria-* props work on native and web alike (RN-Web drops accessibilityState).
          aria-label={inputAccessibilityLabel}
          accessibilityLabel={inputAccessibilityLabel}
          aria-disabled={disabled}
          accessibilityHint={helperText}
          style={[
            styles.input,
            // The placeholder follows the layout direction until the user types.
            !hasText && emptyInputDirectionStyle(),
            multiline && styles.inputMultiline,
            disabled && styles.inputDisabled,
            style,
          ]}
        />
      </Pressable>
      <FieldMessage helperText={helperText} errorText={errorText} />
    </View>
  );
});

/** Helper text, or the error message with an alert icon (announced politely). */
function FieldMessage({ helperText, errorText }: Pick<TextFieldProps, 'helperText' | 'errorText'>) {
  const styles = useTextFieldStyles();
  const { colors } = useTheme();
  if (errorText) {
    return (
      <View style={styles.messageRow} role="alert" aria-live="polite">
        <Ionicons name="alert-circle" size={MESSAGE_ICON_SIZE} color={colors.error} />
        <Text style={[styles.message, styles.messageError]}>{errorText}</Text>
      </View>
    );
  }
  if (!helperText) return null;
  return <Text style={styles.message}>{helperText}</Text>;
}

const useTextFieldStyles = makeUseStyles(({ colors }) => ({
  container: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  field: {
    // Plain `row`: it already starts on the reading-start edge (native mirrors it
    // under forceRTL, web inherits `dir="rtl"`), so the icon lands on the start side.
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48, // layout size: ≥ 44 tap target
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fieldMultiline: { minHeight: 96, alignItems: 'flex-start', paddingVertical: spacing.sm },
  fieldFocused: { borderColor: colors.primary },
  fieldError: { borderColor: colors.error },
  fieldDisabled: { backgroundColor: colors.skeleton },
  // Pins the icon to the first text line instead of the top border.
  iconMultiline: { marginTop: spacing.xs },
  input: {
    flex: 1,
    alignSelf: 'stretch',
    ...typography.bodyLarge,
    color: colors.textPrimary,
    // FR-RESP-006 AC21: direction comes from the typed content, not the layout.
    textAlign: 'auto',
    writingDirection: 'auto',
    padding: 0,
    ...WEB_NO_FOCUS_RING,
  },
  inputMultiline: { verticalAlign: 'top' },
  inputDisabled: { color: colors.textDisabled },
  messageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  message: { ...typography.bodySmall, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  messageError: { color: colors.error },
}));
