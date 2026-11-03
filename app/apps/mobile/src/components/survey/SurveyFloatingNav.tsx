// Production survey floating nav — bottom-anchored prev/next pills.
// FR-SETTINGS-016 AC3: floating controls above tab bar, never hidden.
import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, radius, shadow, spacing, typography, useTheme, Text, zIndex } from '@kc/ui';
import { webTextRtl, webViewRtl } from '../../lib/webRtlStyle';
import { MirroredIcon } from '../ui/MirroredIcon';

type SurveyFloatingNavProps = {
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly prevDisabled: boolean;
  readonly nextDisabled: boolean;
  readonly bottom: number;
  /** Overrides the default `survey.nextLabel` value (e.g. the `survey.lastLabel` finish copy on the final question). */
  readonly nextLabel?: string;
};

const DOCK_HORIZONTAL_INSETS: Pick<ViewStyle, 'left' | 'right'> = {
  left: spacing.base,
  right: spacing.base,
};

export function SurveyFloatingNav({
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  bottom,
  nextLabel,
}: SurveyFloatingNavProps) {
  const styles = useNavStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <View
      style={[styles.dock, DOCK_HORIZONTAL_INSETS, { bottom }]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={onPrev}
        disabled={prevDisabled}
        style={({ pressed }) => [
          styles.pill,
          styles.pillSecondary,
          prevDisabled && styles.pillDisabled,
          pressed && !prevDisabled && styles.pillPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={t('surveyDemo.navPrevA11y')}
        accessibilityState={{ disabled: prevDisabled }}
      >
        <MirroredIcon
          name="chevron-back"
          size={iconSize.md}
          color={prevDisabled ? colors.textDisabled : colors.textPrimary}
        />
        <Text style={[styles.pillText, prevDisabled && styles.pillTextDisabled]}>
          {t('surveyDemo.navPrev')}
        </Text>
      </Pressable>

      <Pressable
        onPress={onNext}
        disabled={nextDisabled}
        style={({ pressed }) => [
          styles.pill,
          styles.pillPrimary,
          nextDisabled && styles.pillDisabled,
          pressed && !nextDisabled && styles.pillPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={t('surveyDemo.navNextA11y')}
        accessibilityState={{ disabled: nextDisabled }}
      >
        <Text style={[styles.pillTextPrimary, nextDisabled && styles.pillTextDisabledOnPrimary]}>
          {nextLabel ?? t('surveyDemo.navNext')}
        </Text>
        <MirroredIcon
          name="chevron-forward"
          size={iconSize.md}
          color={nextDisabled ? colors.textDisabled : colors.textInverse}
        />
      </Pressable>
    </View>
  );
}

/** Reserve scroll space so content clears the floating nav pills. */
export const SURVEY_FLOAT_NAV_CLEARANCE = 52;

const useNavStyles = makeUseStyles(({ colors }) => ({
  dock: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: zIndex.floating,
    ...webViewRtl,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: radius.full,
    minHeight: 48,
    ...shadow.modal,
    shadowColor: colors.shadow,
    ...webViewRtl,
  },
  pillSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillPrimary: {
    backgroundColor: colors.primary,
    borderWidth: 0,
  },
  pillDisabled: {
    opacity: 0.55,
    shadowOpacity: 0,
    elevation: 0,
  },
  pillPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
  pillText: {
    ...typography.button,
    fontSize: typography.button.fontSize,
    color: colors.textPrimary,
    ...webTextRtl,
  },
  pillTextPrimary: {
    ...typography.button,
    fontSize: typography.button.fontSize,
    color: colors.textInverse,
    ...webTextRtl,
  },
  pillTextDisabled: {
    color: colors.textDisabled,
  },
  pillTextDisabledOnPrimary: {
    color: colors.textDisabled,
  },
}));
