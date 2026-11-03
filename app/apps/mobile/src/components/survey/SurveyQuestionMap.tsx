// Production survey question map — accepts SurveyQuestion[] from @kc/domain.
// FR-SETTINGS-016 AC1: compact map with number + short label + completion dot.
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, radius, spacing, typography, useTheme, Text, iconSize } from '@kc/ui';
import type { SurveyQuestion } from '@kc/domain';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../lib/webRtlStyle';

export type QuestionCompletion = 'empty' | 'partial' | 'done';

/** 'done' once the question has its value: a rating or, for single-choice questions, an option. */
export function getQuestionCompletion(
  rating: number | null | undefined,
  text: string,
  choiceKey?: string | null,
): QuestionCompletion {
  if (rating != null || choiceKey != null) return 'done';
  if (text.trim().length > 0) return 'partial';
  return 'empty';
}

type AnswerMap = Readonly<
  Record<string, { rating: number | null; choiceKey?: string | null; answerText: string | null }>
>;

type SurveyQuestionMapProps = {
  readonly questions: readonly SurveyQuestion[];
  readonly activeIndex: number;
  readonly answers: AnswerMap;
  readonly onSelect: (index: number) => void;
  readonly variant: 'rail' | 'chips';
};

export function SurveyQuestionMap({
  questions,
  activeIndex,
  answers,
  onSelect,
  variant,
}: SurveyQuestionMapProps) {
  const styles = useMapStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const isCompact = variant === 'chips';

  const renderCompactChip = (q: SurveyQuestion, index: number) => {
    const answer = answers[q.id] ?? { rating: null, answerText: null };
    const completion = getQuestionCompletion(answer.rating, answer.answerText ?? '', answer.choiceKey);
    const isActive = index === activeIndex;
    const dotColor =
      completion === 'done'
        ? colors.success
        : completion === 'partial'
          ? colors.warning
          : colors.border;

    return (
      <Pressable
        key={q.id}
        onPress={() => onSelect(index)}
        style={[styles.compactChip, isActive && styles.compactChipActive]}
        accessibilityRole="button"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={t('surveyDemo.questionA11y', { index: index + 1, label: q.shortLabelHe })}
      >
        <Text style={[styles.compactNumber, isActive && styles.compactNumberActive]}>
          {index + 1}
        </Text>
        <Text
          style={[styles.compactLabel, isActive && styles.compactLabelActive]}
          numberOfLines={1}
        >
          {q.shortLabelHe}
        </Text>
        <View style={[styles.compactDot, { backgroundColor: dotColor }]} />
      </Pressable>
    );
  };

  const renderRailItem = (q: SurveyQuestion, index: number) => {
    const answer = answers[q.id] ?? { rating: null, answerText: null };
    const completion = getQuestionCompletion(answer.rating, answer.answerText ?? '', answer.choiceKey);
    const isActive = index === activeIndex;
    const statusIcon =
      completion === 'done'
        ? 'checkmark-circle'
        : completion === 'partial'
          ? 'time-outline'
          : 'ellipse-outline';
    const statusColor =
      completion === 'done'
        ? colors.success
        : completion === 'partial'
          ? colors.warning
          : colors.textDisabled;

    return (
      <Pressable
        key={q.id}
        onPress={() => onSelect(index)}
        style={[styles.railItem, isActive && styles.itemActive]}
        accessibilityRole="button"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={t('surveyDemo.questionA11y', { index: index + 1, label: q.shortLabelHe })}
      >
        <Text style={[styles.itemNumber, isActive && styles.itemNumberActive]}>
          {index + 1}
        </Text>
        <Text
          style={[styles.itemLabel, isActive && styles.itemLabelActive]}
          numberOfLines={2}
        >
          {q.shortLabelHe}
        </Text>
        <Ionicons name={statusIcon as never} size={iconSize.sm} color={statusColor} />
      </Pressable>
    );
  };

  if (isCompact) {
    return (
      <View style={styles.compactWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.compactRow}
        >
          {questions.map((q, i) => renderCompactChip(q, i))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.rail}>
      <Text style={styles.railTitle}>{t('surveyDemo.questionMapTitle')}</Text>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.railList}>
        {questions.map((q, i) => renderRailItem(q, i))}
      </ScrollView>
    </View>
  );
}

const useMapStyles = makeUseStyles(({ colors, isDark }) => ({
  compactWrap: {
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...webViewRtl,
  },
  compactRow: {
    paddingHorizontal: spacing.base,
    gap: spacing.xs,
    alignItems: 'center',
    ...webViewRtl,
  },
  compactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    maxWidth: 132,
    ...webViewRtl,
  },
  compactChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySurface,
  },
  compactNumber: {
    fontSize: typography.bodySmall.fontSize,
    lineHeight: 14,
    ...typography.extraBold,
    color: colors.textSecondary,
    minWidth: 14,
    textAlign: 'center',
  },
  compactNumberActive: {
    color: colors.primary,
  },
  compactLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: 14,
    color: colors.textSecondary,
    flexShrink: 1,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  compactLabelActive: {
    color: colors.textPrimary,
    ...typography.semiBold,
  },
  compactDot: {
    width: 6,
    height: 6,
    borderRadius: radius.xs,
    flexShrink: 0,
  },
  rail: {
    width: 148,
    borderInlineStartWidth: 1,
    borderInlineStartColor: colors.border,
    backgroundColor: isDark ? colors.background : colors.surfaceRaised,
    paddingVertical: spacing.sm,
    ...webViewRtl,
  },
  railTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  railList: { paddingBottom: spacing.lg, gap: spacing.xs },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    marginHorizontal: spacing.xs,
    ...webViewRtl,
  },
  itemActive: {
    backgroundColor: colors.primarySurface,
    borderColor: colors.primary,
  },
  itemNumber: {
    ...typography.caption,
    ...typography.bold,
    color: colors.textSecondary,
    minWidth: 18,
    textAlign: 'center',
  },
  itemNumberActive: { color: colors.primary },
  itemLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  itemLabelActive: {
    color: colors.textPrimary,
    ...typography.semiBold,
  },
}));
