// Email verification landing route — FR-AUTH-006 (MVP gate).
// Receives `?token_hash=...&type=signup` from Supabase's confirmation URL,
// exchanges the token for a session, and lets AuthGate route to onboarding/tabs.
// Sibling of auth/callback.tsx (OAuth code exchange).
// docs/SSOT/spec/01_auth_and_onboarding.md
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { isAuthError } from '@kc/application';
import { getVerifyEmailUseCase } from '../../src/services/authComposition';
import { useAuthStore } from '../../src/store/authStore';
import { mapAuthErrorToHebrew } from '../../src/services/authMessages';
import { AuthProgressScreen, AuthStatusScreen } from '../../src/components/auth/AuthStatusScreen';

export default function AuthVerifyScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ token_hash?: string; type?: string }>();
  const setSession = useAuthStore((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);

  const tokenHash = typeof params.token_hash === 'string' ? params.token_hash : undefined;

  useEffect(() => {
    if (!tokenHash) {
      setError(t('auth.verifyInvalidLink'));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { session } = await getVerifyEmailUseCase().execute({ tokenHash });
        if (cancelled) return;
        setSession(session);
        if (
          Platform.OS === 'web' &&
          typeof window !== 'undefined' &&
          window.opener &&
          !window.opener.closed
        ) {
          window.close();
        }
      } catch (err) {
        if (cancelled) return;
        const msg = isAuthError(err)
          ? mapAuthErrorToHebrew(err.code)
          : t('auth.verifyExpired');
        setError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokenHash, setSession, t]);

  if (error) {
    return (
      <AuthStatusScreen
        title={t('auth.verifyFailedTitle')}
        body={error}
        ctaLabel={t('auth.backToSignInCta')}
        onCta={() => router.replace('/(auth)/sign-in')}
      />
    );
  }
  return <AuthProgressScreen message={t('auth.verifyingProgress')} />;
}
