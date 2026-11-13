// Mapped to spec: FR-RESP-006 AC25 / FR-POST-001 AC6 — the one section every form is built from:
// a label (with the required star), the control(s), a hint and, when something is wrong, the
// message right under the control. A section that shows an error takes part in the form scope's
// "jump to the first problem", so no form wires its own scrolling.
import React, { useRef, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { useFormScopeAnchor } from './useFormScopeField';

export interface FormSectionProps {
  /** Heading above the control; omit when the control carries its own label (the kit TextField). */
  readonly label?: string;
  /** Adds the red required star after the label. */
  readonly required?: boolean;
  /** Guidance under the label. */
  readonly hint?: string;
  /** What is wrong with this section; shown under the control and scrolled to on a rejected submit. */
  readonly error?: string | null;
  /** Outline the control in red while there is an error. False when the control draws its own error state. */
  readonly outlined?: boolean;
  /** Layout of the controls inside the outline (e.g. a gap between two controls). */
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
  /** testID of the error message (tests and Maestro flows read the problem through it). */
  readonly errorTestID?: string;
  readonly children: ReactNode;
}

export function FormSection({
  label,
  required,
  hint,
  error = null,
  outlined = true,
  contentStyle,
  style,
  testID,
  errorTestID,
  children,
}: FormSectionProps) {
  const styles = useFormSectionStyles();
  const viewRef = useRef<View>(null);
  useFormScopeAnchor(viewRef, error !== null);
  const showOutline = outlined && error !== null;
  return (
    <View ref={viewRef} collapsable={false} style={[styles.section, style]} testID={testID}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      ) : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={[contentStyle, showOutline && styles.invalid]}>{children}</View>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" testID={errorTestID}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const useFormSectionStyles = makeUseStyles(({ colors }) => ({
  section: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  required: { color: colors.error },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  invalid: { borderWidth: 1.5, borderColor: colors.error, borderRadius: radius.md, padding: spacing.xs },
  error: { ...typography.caption, color: colors.error, textAlign: rtlTextAlignStart },
}));
