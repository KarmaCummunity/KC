// Sign-up with email/password — FR-AUTH-006
import React from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, Text } from '@kc/ui';
import { getSignUpUseCase, AUTH_VERIFY_URL } from '../../src/services/authComposition';
import { useAuthStore } from '../../src/store/authStore';
import { AuthFormScreen } from '../../src/components/auth/AuthFormScreen';
import { useAuthEmailForm } from '../../src/components/auth/useAuthEmailForm';
import { GhostButton } from '../../src/components/ui/Buttons';
import { trackCoreLoop } from '../../src/lib/analyticsCoreLoop';

export default function SignUpScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const setSession = useAuthStore((s) => s.setSession);
  const form = useAuthEmailForm({
    missingFieldsMessage: t('auth.fillAllFields'),
    failureTitle: t('auth.signUpFailedTitle'),
    submit: async (email, password) => {
      const { session, pendingVerification } = await getSignUpUseCase().execute({
        email, password, emailRedirectTo: AUTH_VERIFY_URL,
      });
      trackCoreLoop('signup', { method: 'email' });
      if (session) {
        setSession(session);
        return 'signed-in';
      }
      return pendingVerification ? 'pending-verification' : 'signed-in';
    },
  });

  return (
    <AuthFormScreen
      title={t('auth.signUp')}
      subtitle={t('auth.signUpSubtitle')}
      form={form}
      passwordLabel={t('auth.passwordRuleLabel')}
      passwordPlaceholder={t('auth.passwordPlaceholderNew')}
      submitLabel={t('auth.signUp')}
      footer={
        <>
          <Text style={styles.legal}>{t('auth.bySigningUp')}</Text>
          <GhostButton
            label={t('auth.hasAccountSwitchCta')}
            size="md"
            disabled={form.loading}
            onPress={() => router.replace('/(auth)/sign-in')}
          />
        </>
      }
    />
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  legal: { ...typography.caption, color: colors.textDisabled, textAlign: 'center' },
}));
