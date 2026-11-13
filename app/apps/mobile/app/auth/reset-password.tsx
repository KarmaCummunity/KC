// Password reset landing route — FR-AUTH-008.
import React, { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import { isAuthError } from '@kc/application';
import { getResetPasswordUseCase } from '../../src/services/authComposition';
import { mapAuthErrorToHebrew } from '../../src/services/authMessages';
import { AnimatedAuthInput } from '../../src/components/auth/AnimatedAuthInput';
import { usePasswordResetStyles } from '../../src/components/auth/passwordResetScreen.styles';
import { AuthStatusScreen } from '../../src/components/auth/AuthStatusScreen';
import { FormScreen, PrimaryButton } from '../../src/components/ui';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

type Phase = 'form' | 'done' | 'invalid';

const INVALID_LINK_CODES = new Set(['session_expired', 'authentication_failed', 'invalid_credentials']);

export default function ResetPasswordScreen() {
  const styles = usePasswordResetStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ token_hash?: string; code?: string }>();
  const tokenHash = typeof params.token_hash === 'string' && params.token_hash ? params.token_hash : undefined;
  const code = typeof params.code === 'string' && params.code ? params.code : undefined;

  const [phase, setPhase] = useState<Phase>(tokenHash || code ? 'form' : 'invalid');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (password !== confirm) {
      setError(t('auth.resetPasswordMismatch'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await getResetPasswordUseCase().execute({ tokenHash, code, newPassword: password });
      setPhase('done');
    } catch (err) {
      if (isAuthError(err) && INVALID_LINK_CODES.has(err.code)) setPhase('invalid');
      else setError(isAuthError(err) ? mapAuthErrorToHebrew(err.code) : t('auth.callbackGenericError'));
    } finally {
      setLoading(false);
    }
  };

  if (phase !== 'form') {
    const done = phase === 'done';
    return (
      <AuthStatusScreen
        title={t(done ? 'auth.resetPasswordDoneTitle' : 'auth.verifyFailedTitle')}
        body={t(done ? 'auth.resetPasswordDoneBody' : 'auth.resetPasswordInvalidLink')}
        ctaLabel={t(done ? 'auth.backToSignInCta' : 'auth.requestNewResetLinkCta')}
        onCta={() => router.replace(done ? '/(auth)/sign-in' : '/(auth)/forgot-password')}
        ctaTestID="reset-password-next"
      />
    );
  }

  return (
    <FormScreen
      headerless
      edges={['top', 'bottom']}
      contentContainerStyle={styles.content}
      footer={
        <PrimaryButton
          testID="reset-password-submit"
          label={t('auth.resetPasswordSubmitCta')}
          size="md"
          fullWidth
          loading={loading}
          onPress={onSubmit}
        />
      }
    >
      <Text style={styles.title}>{t('auth.resetPasswordTitle')}</Text>
      <AnimatedAuthInput
        testID="reset-password-new"
        label={t('auth.passwordRuleLabel')}
        value={password}
        onChangeText={setPassword}
        placeholder={t('auth.passwordPlaceholderNew')}
        secureTextEntry
        autoComplete="new-password"
        editable={!loading}
      />
      <AnimatedAuthInput
        testID="reset-password-confirm"
        label={t('auth.resetPasswordConfirmLabel')}
        value={confirm}
        onChangeText={setConfirm}
        placeholder={t('auth.passwordPlaceholderNew')}
        secureTextEntry
        autoComplete="new-password"
        editable={!loading}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormScreen>
  );
}
