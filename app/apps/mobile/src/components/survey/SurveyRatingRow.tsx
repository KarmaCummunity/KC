// Production survey rating row — accepts per-question anchor labels as props.
// FR-SETTINGS-016 AC2: per-question anchor labels (low/high) loaded from server.
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { webTextRtl, webViewRtl } from '../../lib/webRtlStyle';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

const RATINGS = [1, 2, 3, 4, 5, 6, 7] as const;

type SurveyRatingRowProps = {
  readonly value: number | null;
  readonly onChange: (value: number) => void;
  /** Per-question low anchor (renders above cell 1). Falls back to surveyDemo.ratingLowHint. */
  readonly ratingAnchorLow?: string;
  /** Per-question high anchor (renders above cell 7). Falls back to surveyDemo.ratingHighHint. */
  readonly ratingAnchorHigh?: string;
};

export function SurveyRatingRow({
  value,
  onChange,
  ratingAnchorLow,
  ratingAnchorHigh,
}: SurveyRatingRowProps) {
  const styles = useRatingStyles();
  const { t } = useTranslation();

  const lowLabel = ratingAnchorLow ?? t('surveyDemo.ratingLowHint');
  const highLabel = ratingAnchorHigh ?? t('surveyDemo.ratingHighHint');

  return (
    <View style={styles.wrap}>
      <View style={styles.anchorRow}>
        <Text style={styles.anchorText} numberOfLines={1}>{lowLabel}</Text>
        <Text style={styles.anchorText} numberOfLines={1}>{highLabel}</Text>
      </View>
      <View style={styles.row}>
        {RATINGS.map((n) => {
          const selected = value === n;
          return (
            <Pressable
              key={n}
              onPress={() => onChange(n)}
              style={[styles.cell, selected && styles.cellSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t('surveyDemo.ratingCellA11y', { value: n })}
            >
              <Text style={[styles.cellText, selected && styles.cellTextSelected]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useRatingStyles = makeUseStyles(({ colors }) => ({
  wrap: { gap: spacing.xs },
  anchorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    ...webViewRtl,
  },
  anchorText: {
    ...typography.caption,
    color: colors.textDisabled,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  cell: {
    flex: 1,
    minWidth: 36,
    aspectRatio: 1,
    maxHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cellSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  cellText: {
    ...typography.body,
    ...typography.semiBold,
    color: colors.textSecondary,
  },
  cellTextSelected: {
    color: colors.textInverse,
  },
}));
