// Sign-in with email/password — FR-AUTH-007 (email path)
import React from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { isAuthError } from '@kc/application';
import { getSignInUseCase } from '../../src/services/authComposition';
import { useAuthStore } from '../../src/store/authStore';
import { AuthFormScreen } from '../../src/components/auth/AuthFormScreen';
import { useAuthEmailForm } from '../../src/components/auth/useAuthEmailForm';
import { GhostButton } from '../../src/components/ui/Buttons';

export default function SignInScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const setSession = useAuthStore((s) => s.setSession);
  const form = useAuthEmailForm({
    missingFieldsMessage: t('auth.fillEmailAndPassword'),
    failureTitle: t('auth.signInFailedTitle'),
    submit: async (email, password) => {
      try {
        const { session } = await getSignInUseCase().execute({ email, password });
        setSession(session);
        return 'signed-in';
      } catch (err) {
        // An unconfirmed address is not a failure: show the verification panel.
        if (isAuthError(err) && err.code === 'email_not_verified') return 'pending-verification';
        throw err;
      }
    },
  });

  return (
    <AuthFormScreen
      title={t('auth.signInScreenTitle')}
      form={form}
      passwordLabel={t('auth.password')}
      passwordPlaceholder={t('auth.passwordPlaceholder')}
      submitLabel={t('auth.signIn')}
      beforeSubmit={
        <GhostButton
          testID="auth-forgot-password"
          label={t('auth.forgotPassword')}
          size="sm"
          disabled={form.loading}
          onPress={() => router.push({ pathname: '/(auth)/forgot-password', params: { email: form.email } })}
        />
      }
      footer={
        <GhostButton
          label={t('auth.noAccountSwitchCta')}
          size="md"
          disabled={form.loading}
          onPress={() => router.replace('/(auth)/sign-up')}
        />
      }
    />
  );
}
