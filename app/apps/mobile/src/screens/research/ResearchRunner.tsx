// ResearchRunner — public research question flow (FR-RESEARCH-001).
import React from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { PublicResearchError } from '@kc/domain';
import type { PublicResearchBundle } from '@kc/domain';
import { SurveyQuestionMap } from '../../components/survey/SurveyQuestionMap';
import {
  SURVEY_FLOAT_NAV_CLEARANCE,
  SurveyFloatingNav,
} from '../../components/survey/SurveyFloatingNav';
import { webTextRtl, webViewRtl } from '../../lib/webRtlStyle';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { ResearchEndShareCard } from '../../components/research/ResearchEndShareCard';
import { ResearchQuestionPanel } from './ResearchQuestionPanel';
import { SurveyIntroBlock } from './SurveyIntroBlock';

export type AnswerEntry = { rating: number | null; answerText: string | null };

export function errorKey(err: unknown): string {
  if (err instanceof PublicResearchError) {
    if (err.code === 'rate_limited') return 'research.errorRateLimited';
    if (err.code === 'circuit_open') return 'research.errorCircuitOpen';
    if (err.code === 'survey_not_found') return 'research.errorSurveyNotFound';
    if (err.code === 'validation' && err.detail === 'invalid_email') {
      return 'research.errorInvalidEmail';
    }
    if (err.code === 'validation' && err.detail === 'invalid_source_format') {
      return 'research.errorInvalidSource';
    }
    if (err.code === 'network' && err.detail === 'origin_not_allowed') {
      return 'research.errorGeneric';
    }
  }
  return 'research.errorGeneric';
}

type RunnerProps = {
  readonly bundle: PublicResearchBundle;
  readonly activeIndex: number;
  readonly setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  readonly answers: Record<string, AnswerEntry>;
  readonly onAnswerChange: (qid: string, rating: number | null, text: string | null) => void;
  readonly contactEmail: string;
  readonly contactWindowHe: string;
  readonly setContactEmail: (v: string) => void;
  readonly setContactWindowHe: (v: string) => void;
  readonly onAttemptFinish: () => void;
  readonly submitting: boolean;
  readonly submitError: unknown;
  readonly onRetry: () => void;
  readonly missingRatingsHint: boolean;
};

export function ResearchRunner({
  bundle,
  activeIndex,
  setActiveIndex,
  answers,
  onAnswerChange,
  contactEmail,
  contactWindowHe,
  setContactEmail,
  setContactWindowHe,
  onAttemptFinish,
  submitting,
  submitError,
  onRetry,
  missingRatingsHint,
}: RunnerProps) {
  const styles = useRunnerStyles();
  const { t } = useTranslation();
  const questions = bundle.questions;
  const total = questions.length;
  const question = questions[activeIndex];
  const answer = answers[question.id] ?? { rating: null, answerText: null };
  const isLast = activeIndex === total - 1;
  const currentRated = answer.rating !== null;

  let nextLabel: string | undefined;
  if (submitting) {
    nextLabel = t('research.submitting');
  } else if (isLast) {
    nextLabel = t('research.navFinish');
  }

  const goPrev = () => setActiveIndex((i) => Math.max(0, i - 1));

  function handleNext() {
    if (!currentRated) return;
    if (isLast) {
      onAttemptFinish();
      return;
    }
    setActiveIndex((i) => Math.min(total - 1, i + 1));
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: SURVEY_FLOAT_NAV_CLEARANCE + spacing['2xl'] },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        <SurveyIntroBlock />

        <View style={[styles.progressRow, webViewRtl]}>
          <Text style={styles.progressText}>
            {t('research.progress', { current: activeIndex + 1, total })}
          </Text>
          <Text style={styles.progressHint}>{t('research.progressHint')}</Text>
        </View>

        <View style={styles.chipsBleed}>
          <SurveyQuestionMap
            questions={questions}
            activeIndex={activeIndex}
            answers={answers}
            onSelect={setActiveIndex}
            variant="chips"
          />
        </View>

        {missingRatingsHint ? (
          <Text style={styles.missingHint}>{t('research.submitRequiresAllRatings')}</Text>
        ) : null}

        <ResearchQuestionPanel
          question={question}
          index={activeIndex}
          totalQuestions={total}
          answer={answer}
          onRating={(rating) => onAnswerChange(question.id, rating, answer.answerText)}
          onText={(text) => onAnswerChange(question.id, answer.rating, text)}
          contactEmail={contactEmail}
          contactWindowHe={contactWindowHe}
          onContactEmail={setContactEmail}
          onContactWindow={setContactWindowHe}
        />

        {isLast ? <ResearchEndShareCard /> : null}

        {submitError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t(errorKey(submitError))}</Text>
            <Pressable style={styles.retryBtn} onPress={onRetry}>
              <Text style={styles.retryBtnText}>{t('research.retryBtn')}</Text>
            </Pressable>
          </View>
        ) : null}

        {submitting ? (
          <Text style={styles.submittingHint}>{t('research.submitting')}</Text>
        ) : null}
      </ScrollView>

      <SurveyFloatingNav
        onPrev={goPrev}
        onNext={handleNext}
        prevDisabled={activeIndex === 0 || submitting}
        nextDisabled={!currentRated || submitting}
        nextLabel={nextLabel}
        bottom={spacing.xl}
      />
    </KeyboardAvoidingView>
  );
}

const useRunnerStyles = makeUseStyles(({ colors }) => ({
  flex: { flex: 1, minHeight: 0 },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipsBleed: {
    marginHorizontal: -spacing.base,
  },
  progressText: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.textPrimary,
    ...webTextRtl,
  },
  progressHint: {
    ...typography.caption,
    color: colors.textSecondary,
    ...webTextRtl,
  },
  missingHint: {
    ...typography.bodySmall,
    color: colors.error,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  scrollContent: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    gap: spacing.lg,
  },
  errorBox: {
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: 12,
    backgroundColor: colors.errorLight,
    borderWidth: 1,
    borderColor: colors.error,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryBtnText: {
    ...typography.button,
    color: colors.textPrimary,
    ...webTextRtl,
  },
  submittingHint: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    ...webTextRtl,
  },
}));
