// Settings → free feedback — FR-SETTINGS-017.
import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { TextField, FormScreen, PrimaryButton } from '../../src/components/ui';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import { SurveyRatingRow } from '../../src/components/survey/SurveyRatingRow';
import { inputTextAlignStart } from '../../src/lib/rtlLayout';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { useFeedSessionStore } from '../../src/store/feedSessionStore';
import { container } from '../../src/lib/container';
import { track } from '../../src/lib/analytics';

const MIN_BODY = 10;
const MAX_BODY = 500;

export default function FreeFeedbackScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
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
    <>
      <Stack.Screen
        options={{
          ...shellStackScreenOptions,
          headerTitle: t('survey.feedbackTitle'),
        }}
      />
      <FormScreen
        edges={['bottom', 'left', 'right']}
        contentContainerStyle={{ ...styles.scrollContent, ...webViewRtl }}
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
            label={t('survey.feedbackBodyLabel')}
            style={styles.textInput}
            value={body}
            onChangeText={handleBodyChange}
            placeholder={t('survey.feedbackBodyPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            textAlign={inputTextAlignStart()}
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
