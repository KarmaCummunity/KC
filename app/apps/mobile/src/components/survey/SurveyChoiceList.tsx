// Single-choice answer list — one option out of the question's choiceOptions.
// FR-SETTINGS-016 AC8 (KC#1058): used by the Sean Ellis PMF question.
import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, radius, spacing, typography, useTheme, Text, iconSize } from '@kc/ui';
import type { SurveyChoiceOption } from '@kc/domain';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../lib/webRtlStyle';

type SurveyChoiceListProps = {
  readonly options: readonly SurveyChoiceOption[];
  readonly value: string | null;
  readonly onChange: (key: string) => void;
};

export function SurveyChoiceList({ options, value, onChange }: SurveyChoiceListProps) {
  const styles = useChoiceStyles();
  const { colors } = useTheme();

  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = value === option.key;
        return (
          <Pressable
            key={option.key}
            testID={`survey-choice-${option.key}`}
            onPress={() => onChange(option.key)}
            style={[styles.option, selected && styles.optionSelected]}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={option.labelHe}
          >
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={iconSize.lg}
              color={selected ? colors.primary : colors.textDisabled}
            />
            <Text style={[styles.label, selected && styles.labelSelected]}>{option.labelHe}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useChoiceStyles = makeUseStyles(({ colors }) => ({
  list: { gap: spacing.sm, ...webViewRtl },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...webViewRtl,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  label: {
    ...typography.body,
    flex: 1,
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  labelSelected: { ...typography.bold },
}));
