// Settings → free feedback — FR-SETTINGS-017.
import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { TextField, FormScreen, PrimaryButton } from '../../src/components/ui';
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
import { useFormFieldFocus } from '../../src/hooks/useFormFieldFocus';

const MIN_BODY = 10;
const MAX_BODY = 500;

export default function FreeFeedbackScreen() {
  const detailStackScreenOptions = useDetailStackScreenOptions();
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useFeedbackStyles();
  const { colors } = useTheme();
  const showToast = useFeedSessionStore((s) => s.showEphemeralToast);
  const fieldFocus = useFormFieldFocus(1);
  const bodyField = fieldFocus.bindField(0);

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
    <>
      <Stack.Screen
        options={{
          ...detailStackScreenOptions,
          headerTitle: t('survey.feedbackTitle'),
        }}
      />
      <FormScreen
        edges={['bottom', 'left', 'right']}
        contentContainerStyle={{ ...styles.scrollContent, ...webViewRtl }}
        keyboardAccessory={{
          canGoPrev: fieldFocus.canGoPrev,
          canGoNext: fieldFocus.canGoNext,
          onPrev: fieldFocus.focusPrev,
          onNext: fieldFocus.focusNext,
          onDone: fieldFocus.dismiss,
        }}
        footer={
          <PrimaryButton
            label={
              submitting ? t('survey.feedbackSubmitting') : t('survey.feedbackSubmitBtn')
            }
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            onPress={handleSubmit}
          />
        }
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
            ref={bodyField.ref}
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
            onFocus={bodyField.onFocus}
            inputAccessoryViewID={bodyField.inputAccessoryViewID}
            returnKeyType={bodyField.returnKeyType}
            blurOnSubmit={bodyField.blurOnSubmit}
            onSubmitEditing={bodyField.onSubmitEditing}
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
      </FormScreen>
    </>
  );
}

const useFeedbackStyles = makeUseStyles(({ colors }) => ({
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
}));
