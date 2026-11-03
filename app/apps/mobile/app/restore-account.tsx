// FR-AUTH-016 — offered to a signed-in user whose account they deleted: restore it within the
// 30-day grace period, or sign out. Lives at the top level (outside the tab and auth groups),
// like account-blocked, so AuthGate does not move the user away from it.
import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { RestoreAccountError } from '@kc/application';
import { GhostButton, PrimaryButton } from '../src/components/ui';
import { container } from '../src/lib/container';
import { useAuthStore } from '../src/store/authStore';
import { performFullSignOut } from '../src/services/performFullSignOut';

export { RouteErrorBoundary as ErrorBoundary } from '../src/components/RouteErrorBoundary';

type RestoreErrorKey = 'generic' | 'expired';

/** The message for a failed restore; an account that is already active needs none. */
function errorKeyFor(error: unknown): RestoreErrorKey | 'alreadyActive' {
  if (error instanceof RestoreAccountError) {
    if (error.code === 'not_pending_deletion') return 'alreadyActive';
    if (error.code === 'grace_expired') return 'expired';
  }
  return 'generic';
}

export default function RestoreAccountScreen() {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOutLocal = useAuthStore((s) => s.signOut);
  const { until } = useLocalSearchParams<{ until?: string }>();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<RestoreErrorKey | null>(null);

  const date = until
    ? new Date(until).toLocaleDateString(i18n.language === 'he' ? 'he-IL' : 'en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  const goToApp = async () => {
    // Everything cached while the account was hidden is stale; refetch it all.
    await queryClient.invalidateQueries();
    router.replace('/(tabs)');
  };

  const handleRestore = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      await container.restoreAccount.execute();
      await goToApp();
    } catch (error) {
      const key = errorKeyFor(error);
      if (key === 'alreadyActive') await goToApp();
      else setErrorKey(key);
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await performFullSignOut({ deviceRepo: container.deviceRepo, queryClient, signOutLocal });
    } finally {
      setBusy(false);
    }
    router.replace('/(auth)');
  };

  const expired = errorKey === 'expired';

  return (
    <>
      <Stack.Screen options={{ headerTitle: '', headerBackVisible: false }} />
      <View style={styles.container}>
        <Text style={styles.title}>{t('restoreAccount.title')}</Text>
        {expired ? null : <Text style={styles.body}>{t('restoreAccount.body', { date })}</Text>}
        {errorKey ? <Text style={styles.error}>{t(`restoreAccount.errors.${errorKey}`)}</Text> : null}
        {expired ? null : (
          <PrimaryButton
            label={t('restoreAccount.restore')}
            onPress={() => void handleRestore()}
            loading={busy}
            fullWidth
          />
        )}
        <GhostButton label={t('restoreAccount.signOut')} onPress={() => void handleSignOut()} disabled={busy} />
      </View>
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  container: {
    flex: 1,
    padding: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    gap: spacing.lg,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  error: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
  },
}));
