// Mapped to spec: FR-POST-001 AC6 — whole-number fields (seats, passengers, guests…).
// "− n +" stepper clamped to [min, max]; faster and safer than a numeric keyboard.
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  btn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderWidth: isDark ? 1 : 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  btnOff: { opacity: 0.4 },
  value: { ...typography.h3, color: colors.textPrimary, minWidth: 32, textAlign: 'center' as const },
}));

interface Props {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (next: number) => void;
  /** Field name, read by screen readers together with the value. */
  readonly label: string;
  readonly disabled?: boolean;
}

export function CountStepper({ value, min, max, onChange, label, disabled = false }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const canDec = !disabled && value > min;
  const canInc = !disabled && value < max;

  const step = (icon: 'remove' | 'add', enabled: boolean, next: number, testSuffix: string) => (
    <TouchableOpacity
      testID={`count-${testSuffix}`}
      style={[styles.btn, !enabled && styles.btnOff]}
      onPress={() => onChange(Math.min(Math.max(next, min), max))}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${icon === 'add' ? '+' : '−'}`}
      accessibilityState={{ disabled: !enabled }}
    >
      <Ionicons name={icon} size={iconSize.lg} color={colors.textPrimary} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.row} accessibilityLabel={`${label}: ${value}`}>
      {step('remove', canDec, value - 1, 'dec')}
      <Text style={styles.value}>{value}</Text>
      {step('add', canInc, value + 1, 'inc')}
    </View>
  );
}
