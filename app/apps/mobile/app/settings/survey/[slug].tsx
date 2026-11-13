// Settings → survey runner — FR-SETTINGS-016.
// Loads a SurveyBundle, lets the user answer each question, and debounce-saves.
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, useBreakpoint, useTheme, Text } from '@kc/ui';
import { hasSurveyAnswerValue, type SurveyBundle, type SurveyQuestion } from '@kc/domain';
import { useShellStackScreenOptions } from '../../../src/navigation/shellStackScreenOptions';
import { useShellTopBarChrome } from '../../../src/navigation/useShellTopBarChrome';
import { SurveyQuestionMap } from '../../../src/components/survey/SurveyQuestionMap';
import {
  SURVEY_FLOAT_NAV_CLEARANCE,
  SurveyFloatingNav,
} from '../../../src/components/survey/SurveyFloatingNav';
import { NotifyModal } from '../../../src/components/NotifyModal';
import { SurveyThankYouModal } from '../../../src/components/survey/SurveyThankYouModal';
import {
  shellTabBarHeightPx,
  useShellTabBarVisibility,
} from '../../../src/navigation/useShellTabBarVisibility';
import { useKeyboardVerticalOffset } from '../../../src/lib/platform/useKeyboardVerticalOffset';
import { webTextRtl, webViewRtl } from '../../../src/lib/webRtlStyle';
import { container } from '../../../src/lib/container';
import {
  useSurveyRunnerState,
  type SurveyAnswerEntry,
} from '../../../src/hooks/useSurveyRunnerState';
import { track } from '../../../src/lib/analytics';
import { SurveyQuestionPanel } from '../../../src/screens/settings/survey/SurveyQuestionPanel';
import { FormScrollView } from '../../../src/components/ui/FormScrollView';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

// ─── types ───────────────────────────────────────────────────────────────────

type RunnerContentProps = {
  readonly bundle: SurveyBundle;
  readonly activeIndex: number;
  readonly setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  readonly answers: Record<string, SurveyAnswerEntry>;
  readonly onAnswerChange: (qid: string, entry: SurveyAnswerEntry) => void;
  readonly floatNavBottom: number;
  readonly scrollBottomPad: number;
  readonly useSideRail: boolean;
};

// ─── inner component (reduces cognitive complexity of the main screen fn) ────

function RunnerContent({
  bundle,
  activeIndex,
  setActiveIndex,
  answers,
  onAnswerChange,
  floatNavBottom,
  scrollBottomPad,
  useSideRail,
}: RunnerContentProps) {
  const { t } = useTranslation();
  const styles = useRunnerStyles();
  const keyboardOffset = useKeyboardVerticalOffset();

  const questions = bundle.questions as SurveyQuestion[];
  const total = questions.length;
  const question = questions[activeIndex];
  const answer = answers[question.id] ?? { rating: null, choiceKey: null, answerText: null };

  const mapProps = { questions, activeIndex, answers, onSelect: setActiveIndex };
  const goPrev = () => setActiveIndex((i) => Math.max(0, i - 1));
  const goNext = () => setActiveIndex((i) => Math.min(total - 1, i + 1));

  return (
    <KeyboardAvoidingView
      style={[styles.flex, styles.stage]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={keyboardOffset}
    >
      <View style={styles.progressBar}>
        <Text style={styles.progressText}>
          {t('survey.progress', { current: activeIndex + 1, total })}
        </Text>
        <Text style={styles.progressHint}>{t('survey.progressHint')}</Text>
      </View>

      {useSideRail ? null : <SurveyQuestionMap {...mapProps} variant="chips" />}

      <View style={styles.body}>
        {useSideRail ? <SurveyQuestionMap {...mapProps} variant="rail" /> : null}

        <FormScrollView
          style={styles.mainScroll}
          contentContainerStyle={[styles.mainContent, { paddingBottom: scrollBottomPad }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <SurveyQuestionPanel
            question={question}
            index={activeIndex}
            ratingValue={answer.rating}
            choiceValue={answer.choiceKey}
            textValue={answer.answerText ?? ''}
            onRating={(rating) => onAnswerChange(question.id, { ...answer, rating })}
            onChoice={(choiceKey) => onAnswerChange(question.id, { ...answer, choiceKey })}
            onText={(answerText) => onAnswerChange(question.id, { ...answer, answerText })}
          />
        </FormScrollView>
      </View>

      <SurveyFloatingNav
        onPrev={goPrev}
        onNext={goNext}
        prevDisabled={activeIndex === 0}
        nextDisabled={activeIndex >= total - 1}
        bottom={floatNavBottom}
      />
    </KeyboardAvoidingView>
  );
}

// ─── screen ──────────────────────────────────────────────────────────────────

export default function SurveyRunnerScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const { t } = useTranslation();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { colors } = useTheme();
  const bp = useBreakpoint();
  const styles = useRunnerStyles();
  const insets = useSafeAreaInsets();
  const tabBarVisible = useShellTabBarVisibility();
  const useSideRail = bp === 'tablet' || bp === 'desktop' || bp === 'wide';

  const bundleQuery = useQuery({
    queryKey: ['survey-bundle', slug] as const,
    queryFn: () => container.loadSurveyBundle.execute({ slug }),
    enabled: Boolean(slug),
  });

  const bundle = bundleQuery.data;

  useShellTopBarChrome({ title: bundle?.titleHe ?? '' });

  const {
    activeIndex,
    setActiveIndex,
    answers,
    onAnswerChange,
    saveErrorOpen,
    setSaveErrorOpen,
  } = useSurveyRunnerState(bundle ?? null, slug);

  const floatNavBottom = shellTabBarHeightPx(tabBarVisible) + insets.bottom + spacing.md;
  const scrollBottomPad = SURVEY_FLOAT_NAV_CLEARANCE + floatNavBottom + spacing.lg;

  // Analytics: survey_opened on first render once the bundle is loaded.
  const openTrackedRef = useRef(false);
  useEffect(() => {
    if (bundle && !openTrackedRef.current) {
      openTrackedRef.current = true;
      track('survey_opened', { slug, version: bundle.version });
    }
  }, [bundle, slug]);

  // Analytics: survey_completed when every question has its value (rating or choice).
  const completedTrackedRef = useRef(false);
  const [thankYouOpen, setThankYouOpen] = useState(false);
  useEffect(() => {
    if (!bundle || completedTrackedRef.current) return;
    const total = bundle.questions.length;
    if (total === 0) return;
    const answeredCount = Object.values(answers).filter(hasSurveyAnswerValue).length;
    if (answeredCount >= total) {
      completedTrackedRef.current = true;
      track('survey_completed', { slug, version: bundle.version });
      setThankYouOpen(true);
    }
  }, [answers, bundle, slug]);

  function renderBody() {
    if (bundleQuery.isLoading) {
      return <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />;
    }
    if (bundleQuery.isError || !bundle || bundle.questions.length === 0) {
      return <Text style={styles.errorText}>{t('survey.loadErrorMessage')}</Text>;
    }
    return (
      <RunnerContent
        bundle={bundle}
        activeIndex={activeIndex}
        setActiveIndex={setActiveIndex}
        answers={answers}
        onAnswerChange={onAnswerChange}
        floatNavBottom={floatNavBottom}
        scrollBottomPad={scrollBottomPad}
        useSideRail={useSideRail}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <Stack.Screen options={{ ...shellStackScreenOptions }} />
      {renderBody()}
      <NotifyModal
        visible={saveErrorOpen}
        title={t('survey.saveErrorTitle')}
        message={t('survey.saveErrorMessage')}
        onDismiss={() => setSaveErrorOpen(false)}
      />
      <SurveyThankYouModal
        visible={thankYouOpen}
        variant="inApp"
        onDismiss={() => setThankYouOpen(false)}
      />
    </SafeAreaView>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const useRunnerStyles = makeUseStyles(({ colors }) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  stage: { position: 'relative' },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    ...webTextRtl,
  },
  progressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    ...webViewRtl,
  },
  progressText: {
    ...typography.bodySmall,
    ...typography.bold,
    color: colors.textPrimary,
    ...webTextRtl,
  },
  progressHint: {
    ...typography.caption,
    color: colors.textSecondary,
    ...webTextRtl,
  },
  body: { flex: 1, flexDirection: 'row', minHeight: 0, ...webViewRtl },
  mainScroll: { flex: 1 },
  mainContent: { paddingHorizontal: spacing.base, paddingTop: spacing.sm, gap: spacing.sm },
}));
