// LocationDisplayLevelChooser — FR-POST-003 AC3.
// Three-option pill selector for how much of the address shows publicly.
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import type { LocationDisplayLevel } from '@kc/domain';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface Props {
  readonly value: LocationDisplayLevel;
  readonly onChange: (next: LocationDisplayLevel) => void;
  readonly disabled?: boolean;
}

const OPTION_KEYS: { value: LocationDisplayLevel; labelKey: string; hintKey: string }[] = [
  { value: 'CityOnly',      labelKey: 'post.cityOnly',                   hintKey: 'post.locationDisplayHintCityOnly' },
  { value: 'CityAndStreet', labelKey: 'post.locationDisplayCityAndStreet', hintKey: 'post.locationDisplayHintCityAndStreet' },
  { value: 'FullAddress',   labelKey: 'post.fullAddress',                hintKey: 'post.locationDisplayHintFullAddress' },
];

const useLocationDisplayLevelChooserStyles = makeUseStyles(({ colors, isDark }) => ({
  section: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  row: { flexDirection: 'row' as const, gap: spacing.sm },
  btn: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: isDark ? 1 : 1.5,
    borderColor: colors.border,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  btnActive: { backgroundColor: colors.primarySurface, borderColor: colors.primary },
  btnLabel: { ...typography.label, color: colors.textSecondary },
  btnLabelActive: { color: colors.primary },
  btnHint: { ...typography.caption, color: colors.textDisabled },
  btnHintActive: { color: colors.primary },
}));

export function LocationDisplayLevelChooser({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const styles = useLocationDisplayLevelChooserStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{t('post.locationDisplayLabel')}</Text>
      <View style={styles.row}>
        {OPTION_KEYS.map((opt) => {
          const active = value === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.btn, active && styles.btnActive, disabled && { opacity: 0.5 }]}
              onPress={() => !disabled && onChange(opt.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: !!disabled }}
            >
              <Text style={[styles.btnLabel, active && styles.btnLabelActive]}>{t(opt.labelKey)}</Text>
              <Text style={[styles.btnHint, active && styles.btnHintActive]}>{t(opt.hintKey)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
