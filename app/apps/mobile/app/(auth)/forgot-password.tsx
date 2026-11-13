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
import { LaunchSurfaceGate } from '../../src/components/LaunchSurfaceGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

function ForgotPasswordScreenContent() {
  const styles = usePasswordResetStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        testID="forgot-password-email"
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        placeholder={t('auth.emailPlaceholder')}
        editable={!loading}
        inputKind="email"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormScreen>
  );
}

/** Hidden while `emailAuth` is off (first launch): sends the visitor away instead of rendering. */
export default function ForgotPasswordScreen() {
  return (
    <LaunchSurfaceGate surface="emailAuth" redirectTo="/(auth)">
      <ForgotPasswordScreenContent />
    </LaunchSurfaceGate>
  );
}
