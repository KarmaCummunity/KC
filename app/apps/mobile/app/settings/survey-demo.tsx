// Dev-only design QA route — kept under __DEV__ until product confirms removal.
// The production survey runner lives at app/settings/survey/[slug].tsx and
// consumes the live ux-experience survey from Supabase. See FR-SETTINGS-016.
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { makeUseStyles, spacing, typography, useBreakpoint, useTheme, Text } from '@kc/ui';
import { TextField } from '../../src/components/ui';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import {
  shellTabBarHeightPx,
  useShellTabBarVisibility,
} from '../../src/navigation/useShellTabBarVisibility';
import { Card } from '../../src/components/ui/Card';
import { SurveyQuestionMap } from '../../src/components/survey/SurveyQuestionMap';
import {
  SURVEY_FLOAT_NAV_CLEARANCE,
  SurveyFloatingNav,
} from '../../src/components/survey/SurveyFloatingNav';
import { SurveyRatingRow } from '../../src/components/survey/SurveyRatingRow';
import {
  SURVEY_DEMO_QUESTION_IDS,
  useSurveyDemoQuestions,
  type SurveyDemoQuestion,
} from '../../src/components/survey-demo/surveyDemoQuestions';
import {
  toProductionAnswers,
  toProductionQuestions,
} from '../../src/components/survey-demo/surveyDemoAdapter';
import { inputTextAlignStart } from '../../src/lib/rtlLayout';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { useKeyboardVerticalOffset } from '../../src/lib/platform/useKeyboardVerticalOffset';
import { useFormFieldFocus } from '../../src/hooks/useFormFieldFocus';
import type { FormFieldFocusBindings } from '../../src/hooks/useFormFieldFocus';
import { KeyboardFormAccessory } from '../../src/components/ui/KeyboardFormAccessory';

type DemoAnswer = { rating: number | null; text: string };

function emptyAnswers(): Record<string, DemoAnswer> {
  return Object.fromEntries(
    SURVEY_DEMO_QUESTION_IDS.map((id) => [id, { rating: null, text: '' }]),
  );
}

export default function SurveyDemoScreen() {
  // All hooks must run unconditionally (Rules of Hooks). The __DEV__ gate is
  // applied after all hooks have been called.
  const shellStackScreenOptions = useShellStackScreenOptions();
  const { colors } = useTheme();
  const bp = useBreakpoint();
  const styles = useScreenStyles();
  const insets = useSafeAreaInsets();
  const tabBarVisible = useShellTabBarVisibility();
  const { t } = useTranslation();
  const questions = useSurveyDemoQuestions();
  const useSideRail = bp === 'tablet' || bp === 'desktop' || bp === 'wide';
  const keyboardOffset = useKeyboardVerticalOffset();
  const fieldFocus = useFormFieldFocus(1);
  const textFieldFocus = fieldFocus.bindField(0);

  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, DemoAnswer>>(emptyAnswers);

  const floatNavBottom = shellTabBarHeightPx(tabBarVisible) + insets.bottom + spacing.md;
  const scrollBottomPad =
    SURVEY_FLOAT_NAV_CLEARANCE + floatNavBottom + spacing.lg;

  const question = questions[activeIndex] as SurveyDemoQuestion;
  const answer = answers[question.id] ?? { rating: null, text: '' };
  const total = questions.length;

  const setAnswer = (patch: Partial<DemoAnswer>) => {
    setAnswers((prev) => ({
      ...prev,
      [question.id]: { ...(prev[question.id] ?? { rating: null, text: '' }), ...patch },
    }));
  };

  const goPrev = () => setActiveIndex((i) => Math.max(0, i - 1));
  const goNext = () => setActiveIndex((i) => Math.min(total - 1, i + 1));

  const mapProps = useMemo(
    () => ({
      questions: toProductionQuestions(questions),
      activeIndex,
      answers: toProductionAnswers(answers),
      onSelect: setActiveIndex,
    }),
    [questions, activeIndex, answers],
  );

  if (!__DEV__) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <Stack.Screen
        options={{
          ...shellStackScreenOptions,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitle: t('surveyDemo.screenTitle'),
        }}
      />
      <KeyboardAvoidingView
        style={[styles.flex, styles.stage]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardOffset}
      >
        <KeyboardFormAccessory
          canGoPrev={fieldFocus.canGoPrev}
          canGoNext={fieldFocus.canGoNext}
          onPrev={fieldFocus.focusPrev}
          onNext={fieldFocus.focusNext}
          onDone={fieldFocus.dismiss}
        />
        <View style={styles.progressBar}>
          <Text style={styles.progressText}>
            {t('surveyDemo.progress', { current: activeIndex + 1, total })}
          </Text>
          <Text style={styles.progressHint}>{t('surveyDemo.progressHint')}</Text>
        </View>

        {useSideRail ? null : <SurveyQuestionMap {...mapProps} variant="chips" />}

        <View style={styles.body}>
          {useSideRail ? <SurveyQuestionMap {...mapProps} variant="rail" /> : null}

          <ScrollView
            style={styles.mainScroll}
            contentContainerStyle={[styles.mainContent, { paddingBottom: scrollBottomPad }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <QuestionPanel
              question={question}
              index={activeIndex}
              answer={answer}
              onRating={(rating) => setAnswer({ rating })}
              onText={(text) => setAnswer({ text })}
              textFieldFocus={textFieldFocus}
            />
          </ScrollView>
        </View>

        <SurveyFloatingNav
          onPrev={goPrev}
          onNext={goNext}
          prevDisabled={activeIndex === 0}
          nextDisabled={activeIndex >= total - 1}
          bottom={floatNavBottom}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type QuestionPanelProps = {
  readonly question: SurveyDemoQuestion;
  readonly index: number;
  readonly answer: DemoAnswer;
  readonly onRating: (rating: number) => void;
  readonly onText: (text: string) => void;
  readonly textFieldFocus?: FormFieldFocusBindings;
};

function QuestionPanel({ question, index, answer, onRating, onText, textFieldFocus }: QuestionPanelProps) {
  const styles = usePanelStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <Card padding="base" style={styles.card}>
      <Text style={styles.questionIndex}>
        {t('surveyDemo.questionIndex', { index: index + 1 })}
      </Text>
      <Text style={styles.prompt}>{question.prompt}</Text>
      <Text style={styles.context}>{question.context}</Text>

      <Text style={styles.fieldLabel} accessibilityRole="text">
        {t('surveyDemo.ratingFieldLabel')}
      </Text>
      <SurveyRatingRow value={answer.rating} onChange={onRating} />
      <View style={styles.scaleHints}>
        <Text style={styles.scaleHint}>{t('surveyDemo.ratingLowHint')}</Text>
        <Text style={styles.scaleHint}>{t('surveyDemo.ratingHighHint')}</Text>
      </View>

      <TextField
        ref={textFieldFocus?.ref}
        label={t('surveyDemo.textFieldLabel')}
        style={styles.textInput}
        value={answer.text}
        onChangeText={onText}
        placeholder={question.textPlaceholder}
        placeholderTextColor={colors.textDisabled}
        textAlign={inputTextAlignStart()}
        multiline
        maxLength={500}
        accessibilityLabel={question.textPlaceholder}
        onFocus={textFieldFocus?.onFocus}
        inputAccessoryViewID={textFieldFocus?.inputAccessoryViewID}
        returnKeyType={textFieldFocus?.returnKeyType}
        blurOnSubmit={textFieldFocus?.blurOnSubmit}
        onSubmitEditing={textFieldFocus?.onSubmitEditing}
      />
    </Card>
  );
}

const useScreenStyles = makeUseStyles(({ colors }) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  stage: { position: 'relative' },
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
  mainContent: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
}));

const usePanelStyles = makeUseStyles(({ colors }) => ({
  card: {
    gap: spacing.sm,
    alignSelf: 'stretch',
  },
  questionIndex: {
    ...typography.caption,
    color: colors.primary,
    ...typography.bold,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  prompt: {
    ...typography.h3,
    fontSize: typography.h3.fontSize,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    lineHeight: 26,
    ...webTextRtl,
  },
  context: {
    ...typography.body,
    fontSize: typography.bodyLarge.fontSize,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    lineHeight: 23,
    ...webTextRtl,
  },
  fieldLabel: {
    ...typography.bodySmall,
    ...typography.semiBold,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    marginTop: spacing.xs,
    ...webTextRtl,
  },
  scaleHints: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    ...webViewRtl,
  },
  scaleHint: {
    ...typography.caption,
    color: colors.textDisabled,
    ...webTextRtl,
  },
  textInput: {
    fontSize: typography.bodyLarge.fontSize,
    lineHeight: 22,
    minHeight: 88,
    maxHeight: 128,
    textAlignVertical: 'top',
  },
}));
