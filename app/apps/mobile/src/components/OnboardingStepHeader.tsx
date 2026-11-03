// FR-AUTH-018 + FR-AUTH-010..012 — onboarding chrome: skip · step · back (4 steps).
import React from 'react';
import { View, TouchableOpacity, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { MirroredIcon, useDirectionalBackIcon } from './ui/MirroredIcon';
import { OnboardingProgressBar } from './animations/OnboardingProgressBar';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';

export interface OnboardingStepHeaderProps {
  readonly step: 1 | 2 | 3 | 4;
  readonly onSkip: () => void;
  /** Omitted on step 1 (no back affordance). */
  readonly onBack?: () => void;
  readonly skipDisabled?: boolean;
  readonly backDisabled?: boolean;
}

export function OnboardingStepHeader({
  step,
  onSkip,
  onBack = () => {},
  skipDisabled = false,
  backDisabled = false,
}: OnboardingStepHeaderProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const backIcon = useDirectionalBackIcon();
  const showBack = step > 1;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TouchableOpacity
          onPress={onSkip}
          disabled={skipDisabled}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.skip')}
          style={styles.side}
        >
          <Text style={[styles.skip, skipDisabled && styles.muted]}>{t('onboarding.skip')}</Text>
        </TouchableOpacity>
        <Text style={styles.step} accessibilityRole="text">
          {t('onboarding.stepProgress', { step })}
        </Text>
        {showBack ? (
          <Pressable
            onPress={onBack}
            disabled={backDisabled}
            accessibilityRole="button"
            accessibilityLabel={t('general.back')}
            hitSlop={12}
            style={({ pressed }) => [styles.side, pressed && { opacity: 0.6 }]}
          >
            <MirroredIcon
              name={backIcon}
              size={iconSize.xl}
              color={backDisabled ? colors.textDisabled : colors.primary}
            />
          </Pressable>
        ) : (
          <View style={styles.side} />
        )}
      </View>
      <OnboardingProgressBar step={step} />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  side: { minWidth: 72, justifyContent: 'center', alignItems: 'center' },
  step: {
    ...typography.caption,
    flex: 1,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  skip: { ...typography.body, color: colors.primary, textAlign: rtlTextAlignStart },
  muted: { color: colors.textDisabled },
}));
