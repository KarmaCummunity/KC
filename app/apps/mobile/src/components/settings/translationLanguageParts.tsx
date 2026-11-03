// Sub-component for the Translation-Language settings screen (FR-TRANSLATE-003).
// Lives under src/ (not app/) so expo-router does not register it as a route.
import React from 'react';
import { Pressable, View } from 'react-native';
import { makeUseStyles, spacing, radius, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../lib/webRtlStyle';

interface LanguageRowProps {
  readonly label: string;
  readonly hint?: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export function LanguageRow({ label, hint, selected, disabled, onSelect }: LanguageRowProps) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onSelect}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.textCol}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...webViewRtl,
  },
  rowSelected: { backgroundColor: colors.primarySurface },
  rowPressed: { opacity: 0.7 },
  textCol: { flex: 1 },
  label: {
    ...typography.body,
    color: colors.textPrimary,
    ...typography.semiBold,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  radioSelected: { borderColor: colors.primary },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
}));
