// Web-only research question panel — extracted to keep [slug].web.tsx under 300 LOC.
// Displays one question card: prompt + rating row + optional text + Q11 contact fields.
// FR-RESEARCH-001 AC3, FR-RESEARCH-003 AC1.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, radius, typography, useTheme, Text } from '@kc/ui';
import { TextField } from '../../components/ui/TextField';
import type { SurveyQuestion } from '@kc/domain';
import { SurveyRatingRow } from '../../components/survey/SurveyRatingRow';
import { webTextRtl } from '../../lib/webRtlStyle';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

// Q11 is the final "contact us" question — identified by its position as the
// last question in the survey (design spec §9 row 11). Using sort_order keeps
// the Q11 sentinel out of the source tree (Hebrew-scan compliance).
type AnswerEntry = { rating: number | null; answerText: string | null };

type Props = {
  readonly question: SurveyQuestion;
  readonly index: number;
  readonly totalQuestions: number;
  readonly answer: AnswerEntry;
  readonly onRating: (rating: number) => void;
  readonly onText: (text: string) => void;
  readonly contactEmail: string;
  readonly contactWindowHe: string;
  readonly onContactEmail: (v: string) => void;
  readonly onContactWindow: (v: string) => void;
};

export function ResearchQuestionPanel({
  question,
  index,
  totalQuestions,
  answer,
  onRating,
  onText,
  contactEmail,
  contactWindowHe,
  onContactEmail,
  onContactWindow,
}: Props) {
  const styles = usePanelStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const isQ11 = index === totalQuestions - 1;

  return (
    <View style={styles.card}>
      <Text style={styles.questionIndex}>
        {t('research.questionIndex', { index: index + 1 })}
      </Text>
      <Text style={styles.prompt}>{question.promptHe}</Text>
      {question.contextHe ? (
        <Text style={styles.context}>{question.contextHe}</Text>
      ) : null}

      <Text style={styles.fieldLabel}>{t('research.ratingFieldLabel')}</Text>
      <SurveyRatingRow
        value={answer.rating}
        onChange={onRating}
        ratingAnchorLow={question.ratingAnchorLowHe || undefined}
        ratingAnchorHigh={question.ratingAnchorHighHe || undefined}
      />

      <TextField
        label={t('research.textFieldLabel')}
        style={styles.textInput}
        value={answer.answerText ?? ''}
        onChangeText={onText}
        placeholder={question.textPlaceholderHe}
        placeholderTextColor={colors.textDisabled}
        textAlign={rtlTextAlignStart}
        multiline
        maxLength={500}
        accessibilityLabel={question.textPlaceholderHe}
      />

      {isQ11 ? (
        <View style={styles.contactSection}>
          <Text style={styles.contactTitle}>{t('research.contactSectionTitle')}</Text>
          <TextField
            label={t('research.contactEmailLabel')}
            style={typography.body}
            value={contactEmail}
            onChangeText={onContactEmail}
            placeholder={t('research.contactEmailPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            textAlign={rtlTextAlignStart}
            maxLength={320}
            inputKind="email"
            accessibilityLabel={t('research.contactEmailLabel')}
          />
          <TextField
            label={t('research.contactWindowLabel')}
            style={typography.body}
            value={contactWindowHe}
            onChangeText={onContactWindow}
            placeholder={t('research.contactWindowPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            textAlign={rtlTextAlignStart}
            maxLength={200}
            accessibilityLabel={t('research.contactWindowLabel')}
          />
        </View>
      ) : null}
    </View>
  );
}

const usePanelStyles = makeUseStyles(({ colors }) => ({
  card: {
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  questionIndex: {
    ...typography.caption,
    color: colors.primary,
    letterSpacing: 0.4,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  prompt: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  context: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  fieldLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    marginTop: spacing.sm,
    ...webTextRtl,
  },
  textInput: {
    ...typography.body,
    minHeight: 120,
    maxHeight: 168,
    textAlignVertical: 'top',
  },
  contactSection: {
    gap: spacing.md,
    marginTop: spacing.base,
    paddingTop: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  contactTitle: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
}));
