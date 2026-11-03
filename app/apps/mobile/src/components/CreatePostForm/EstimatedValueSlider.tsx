// FR-KARMA-004 — centered title + 0..1000 (step 50) slider, "1000+" top label.
// Give posts only (mounted under the isGive block in CreatePostFormScrollContent).
import React from 'react';
import { View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';

const MAX = 1000;
const STEP = 50;

export function EstimatedValueSlider({
  value,
  onChange,
}: {
  readonly value: number;
  readonly onChange: (next: number) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useSliderStyles();
  const atMax = value >= MAX;
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t('karma.estimatedValueTitle')}</Text>
      <Text style={styles.amount}>
        {atMax ? t('karma.estimatedValueMax') : t('karma.estimatedValueAmount', { value })}
      </Text>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={MAX}
        step={STEP}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor={colors.primary}
        maximumTrackTintColor={colors.border}
        accessibilityLabel={t('karma.estimatedValueTitle')}
      />
      <Text style={styles.hint}>{t('karma.estimatedValueHint')}</Text>
    </View>
  );
}

const useSliderStyles = makeUseStyles(({ colors }) => ({
  wrap: {
    marginTop: spacing.base,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { ...typography.h4, color: colors.textPrimary, textAlign: 'center' as const },
  amount: { ...typography.h3, color: colors.primary, textAlign: 'center' as const, marginTop: spacing.xs },
  slider: { width: '100%' as const, height: 40, marginTop: spacing.xs },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' as const },
}));
