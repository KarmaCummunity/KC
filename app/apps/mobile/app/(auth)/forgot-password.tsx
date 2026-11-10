// Forgot password — FR-AUTH-008 (email accounts).
import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing, Text } from '@kc/ui';
import { isAuthError } from '@kc/application';
import { AUTH_RESET_PASSWORD_URL, getRequestPasswordResetUseCase } from '../../src/services/authComposition';
import { mapAuthErrorToHebrew } from '../../src/services/authMessages';
import { AnimatedAuthInput } from '../../src/components/auth/AnimatedAuthInput';
import { usePasswordResetStyles } from '../../src/components/auth/passwordResetScreen.styles';
import { AuthStatusScreen } from '../../src/components/auth/AuthStatusScreen';
import { FormScreen, GhostButton, PrimaryButton } from '../../src/components/ui';
import { useFormFieldFocus } from '../../src/hooks/useFormFieldFocus';
import { formEmailInputProps } from '../../src/lib/platform/formTextInputHints';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function ForgotPasswordScreen() {
  const styles = usePasswordResetStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldFocus = useFormFieldFocus(1);
  const emailField = fieldFocus.bindField(0);

  const onSubmit = async () => {
    if (!email.trim()) {
      setError(t('auth.forgotPasswordEmailRequired'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await getRequestPasswordResetUseCase().execute({ email, redirectTo: AUTH_RESET_PASSWORD_URL });
      setSent(true);
    } catch (err) {
      setError(isAuthError(err) ? mapAuthErrorToHebrew(err.code) : t('auth.callbackGenericError'));
    } finally {
      setLoading(false);
    }
  };

  const backToSignIn = () => router.replace('/(auth)/sign-in');

  if (sent) {
    return (
      <AuthStatusScreen
        title={t('auth.forgotPasswordSentTitle')}
        body={t('auth.forgotPasswordSentBody')}
        ctaLabel={t('auth.backToSignInCta')}
        onCta={backToSignIn}
        ctaTestID="forgot-password-back"
      />
    );
  }

  return (
    <FormScreen
      headerless
      edges={['top', 'bottom']}
      contentContainerStyle={styles.content}
      keyboardAccessory={{
        canGoPrev: fieldFocus.canGoPrev,
        canGoNext: fieldFocus.canGoNext,
        onPrev: fieldFocus.focusPrev,
        onNext: fieldFocus.focusNext,
        onDone: fieldFocus.dismiss,
      }}
      footer={
        <View style={{ gap: spacing.sm }}>
          <PrimaryButton
            testID="forgot-password-submit"
            label={t('auth.forgotPasswordSubmitCta')}
            size="md"
            fullWidth
            loading={loading}
            onPress={onSubmit}
          />
          <GhostButton
            label={t('auth.backToSignInCta')}
            size="md"
            fullWidth
            disabled={loading}
            onPress={backToSignIn}
          />
        </View>
      }
    >
      <Text style={styles.title}>{t('auth.forgotPasswordTitle')}</Text>
      <Text style={styles.body}>{t('auth.forgotPasswordBody')}</Text>
      <AnimatedAuthInput
        ref={emailField.ref}
        testID="forgot-password-email"
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        placeholder={t('auth.emailPlaceholder')}
        editable={!loading}
        {...formEmailInputProps}
        onFocus={emailField.onFocus}
        inputAccessoryViewID={emailField.inputAccessoryViewID}
        returnKeyType={emailField.returnKeyType}
        blurOnSubmit={emailField.blurOnSubmit}
        onSubmitEditing={emailField.onSubmitEditing}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormScreen>
  );
}
