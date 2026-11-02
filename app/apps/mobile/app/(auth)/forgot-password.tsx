// Forgot password — FR-AUTH-008 (email accounts).
// Sends a reset link and always shows the same confirmation, whether or not
// the address is registered (AC1, anti-enumeration). The link lands on
// `/auth/reset-password`.
// docs/SSOT/spec/01_auth_and_onboarding.md
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@kc/ui';
import { isAuthError } from '@kc/application';
import { AUTH_RESET_PASSWORD_URL, getRequestPasswordResetUseCase } from '../../src/services/authComposition';
import { mapAuthErrorToHebrew } from '../../src/services/authMessages';
import { AnimatedAuthInput } from '../../src/components/auth/AnimatedAuthInput';
import { usePasswordResetStyles } from '../../src/components/auth/passwordResetScreen.styles';
import { AuthStatusScreen } from '../../src/components/auth/AuthStatusScreen';
import { GhostButton, PrimaryButton } from '../../src/components/ui/Buttons';

export default function ForgotPasswordScreen() {
  const styles = usePasswordResetStyles();
  const router = useRouter();
  const { t } = useTranslation();
  // Prefilled when opened from the sign-in screen.
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
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{t('auth.forgotPasswordTitle')}</Text>
          <Text style={styles.body}>{t('auth.forgotPasswordBody')}</Text>
          <AnimatedAuthInput
            testID="forgot-password-email"
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            placeholder={t('auth.emailPlaceholder')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            editable={!loading}
            onSubmitEditing={onSubmit}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton
            testID="forgot-password-submit"
            label={t('auth.forgotPasswordSubmitCta')}
            size="md"
            fullWidth
            loading={loading}
            onPress={onSubmit}
          />
          <GhostButton label={t('auth.backToSignInCta')} size="md" fullWidth disabled={loading} onPress={backToSignIn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
