// Settings → free feedback — FR-SETTINGS-017.
// Optional 1–7 rating + required text (10–500 chars); submits to SubmitFreeFeedbackUseCase.
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { TextField } from '../../src/components/ui';
import { useDetailStackScreenOptions } from '../../src/navigation/detailStackScreenOptions';
import { SurveyRatingRow } from '../../src/components/survey/SurveyRatingRow';
import {
  hebrewSurveyFieldTextStyle,
  SURVEY_TEXT_ALIGN,
} from '../../src/components/survey/hebrewSurveyFieldStyle';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { useFeedSessionStore } from '../../src/store/feedSessionStore';
import { container } from '../../src/lib/container';
import { track } from '../../src/lib/analytics';

const MIN_BODY = 10;
const MAX_BODY = 500;

export default function FreeFeedbackScreen() {
  const detailStackScreenOptions = useDetailStackScreenOptions();
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useFeedbackStyles();
  const { colors } = useTheme();
  const showToast = useFeedSessionStore((s) => s.showEphemeralToast);

  const [rating, setRating] = useState<number | null>(null);
  const [body, setBody] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const bodyTrimLen = body.trim().length;
  const isBodyValid = bodyTrimLen >= MIN_BODY && bodyTrimLen <= MAX_BODY;
  const canSubmit = isBodyValid && !submitting;

  const handleBodyChange = (text: string) => {
    setBody(text);
    if (validationError) setValidationError(null);
  };

  const handleSubmit = async () => {
    if (!isBodyValid) {
      if (bodyTrimLen < MIN_BODY) {
        setValidationError(t('survey.feedbackErrorBodyTooShort'));
      } else {
        setValidationError(t('survey.feedbackErrorBodyTooLong'));
      }
      return;
    }

    setSubmitting(true);
    try {
      await container.submitFreeFeedback.execute({ rating, body });
      track('feedback_submitted');
      showToast(t('survey.feedbackSuccessToast'), 'success', 2200);
      router.back();
    } catch {
      setValidationError(t('survey.feedbackErrorGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          ...detailStackScreenOptions,
          headerTitle: t('survey.feedbackTitle'),
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.fieldLabel}>{t('survey.feedbackRatingLabel')}</Text>
          <SurveyRatingRow
            value={rating}
            onChange={(v) => setRating(v === rating ? null : v)}
            ratingAnchorLow={t('survey.feedbackRatingLow')}
            ratingAnchorHigh={t('survey.feedbackRatingHigh')}
          />

          <View style={styles.inputWrap}>
            <TextField
              label={t('survey.feedbackBodyLabel')}
              style={[styles.textInput, hebrewSurveyFieldTextStyle()]}
              value={body}
              onChangeText={handleBodyChange}
              placeholder={t('survey.feedbackBodyPlaceholder')}
              placeholderTextColor={colors.textDisabled}
              textAlign={SURVEY_TEXT_ALIGN}
              multiline
              maxLength={MAX_BODY}
              accessibilityLabel={t('survey.feedbackBodyLabel')}
            />
            <Text
              style={[
                styles.counter,
                bodyTrimLen > MAX_BODY && styles.counterError,
              ]}
            >
              {bodyTrimLen}/{MAX_BODY}
            </Text>
          </View>

          {validationError ? (
            <Text style={styles.error}>{validationError}</Text>
          ) : null}

          <Pressable
            style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.submitText}>
                {submitting
                  ? t('survey.feedbackSubmitting')
                  : t('survey.feedbackSubmitBtn')}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useFeedbackStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.background, ...webViewRtl },
  flex: { flex: 1 },
  scrollContent: {
    padding: spacing.base,
    gap: spacing.md,
  },
  fieldLabel: {
    ...typography.bodySmall,
    ...typography.semiBold,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  inputWrap: { gap: spacing.xs },
  textInput: {
    ...typography.button,
    lineHeight: 22,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  counter: {
    ...typography.caption,
    color: colors.textDisabled,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  counterError: {
    color: colors.error,
  },
  error: {
    ...typography.caption,
    color: colors.error,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitText: {
    ...typography.button,
    color: colors.textInverse,
    ...typography.bold,
    ...webTextRtl,
  },
}));
