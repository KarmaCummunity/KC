// Mapped to spec: FR-RESP-006 AC29 — the line under a form field: its hint, or its error with an
// alert icon. Shared by the kit `TextField` and the auth input so every field reports a problem the
// same way, in the same place.
import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

/** Ionicons glyph size next to the error message. */
const MESSAGE_ICON_SIZE = 14;

export interface FieldMessageProps {
  readonly helperText?: string;
  /** Validation message; when set it replaces the hint. */
  readonly errorText?: string;
}

/** Helper text, or the error message with an alert icon (announced politely). Nothing when both are empty. */
export function FieldMessage({ helperText, errorText }: FieldMessageProps) {
  const styles = useFieldMessageStyles();
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

const useFieldMessageStyles = makeUseStyles(({ colors }) => ({
  messageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  message: { ...typography.bodySmall, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  messageError: { color: colors.error },
}));
