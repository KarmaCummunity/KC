// Async actions + modal state for `app/settings.tsx` (keeps screen under arch line cap).
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getDeleteAccountUseCase, resetOnboardingForDev } from '../services/userComposition';
import { performFullSignOut } from '../services/performFullSignOut';
import { useAuthStore } from '../store/authStore';
import { container } from '../lib/container';

export function useSettingsAccountActions() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const setOnboardingStateLocal = useAuthStore((s) => s.setOnboardingState);
  const signOutLocal = useAuthStore((s) => s.signOut);
  const [signingOut, setSigningOut] = useState(false);
  const [resettingOnboarding, setResettingOnboarding] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteSuccessVisible, setDeleteSuccessVisible] = useState(false);

  const handleDeleteConfirm = useCallback(async () => {
    await getDeleteAccountUseCase().execute();
    setDeleteModalVisible(false);
    setDeleteSuccessVisible(true);
    setTimeout(async () => {
      try {
        await performFullSignOut({
          deviceRepo: container.deviceRepo,
          queryClient,
          signOutLocal,
        });
      } finally {
        setDeleteSuccessVisible(false);
        router.replace('/(auth)');
      }
    }, 1500);
  }, [queryClient, router, signOutLocal]);

  const performReset = useCallback(async () => {
    if (!session) return;
    setResettingOnboarding(true);
    try {
      await resetOnboardingForDev();
      setOnboardingStateLocal('pending_basic_info');
      useAuthStore.getState().setBasicInfoSkipped(false);
      router.replace('/(onboarding)/about-intro');
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('general.unknownError');
      if (Platform.OS === 'web') {
        const w = globalThis as unknown as { alert: (m: string) => void };
        w.alert(t('settings.resetOnboardingFailed', { msg }));
      } else Alert.alert(t('settings.resetOnboardingFailed', { msg: '' }), msg);
    } finally {
      setResettingOnboarding(false);
    }
  }, [router, session, setOnboardingStateLocal, t]);

  const handleResetOnboarding = useCallback(() => {
    if (!session || resettingOnboarding) return;
    const msg = t('settings.resetOnboardingConfirmMsg');
    if (Platform.OS === 'web') {
      const w = globalThis as unknown as { confirm: (m: string) => boolean };
      if (w.confirm(msg)) void performReset();
      return;
    }
    Alert.alert(t('settings.resetOnboardingConfirmTitle'), msg, [
      { text: t('general.cancel'), style: 'cancel' },
      { text: t('settings.resetOnboardingBtn'), style: 'destructive', onPress: () => void performReset() },
    ]);
  }, [performReset, resettingOnboarding, session, t]);

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await performFullSignOut({
        deviceRepo: container.deviceRepo,
        queryClient,
        signOutLocal,
      });
      router.replace('/(auth)');
    } catch {
      Alert.alert(t('general.error'), t('settings.signOutFailed'));
    } finally {
      setSigningOut(false);
    }
  }, [queryClient, router, signOutLocal, signingOut, t]);

  return {
    signingOut,
    resettingOnboarding,
    deleteModalVisible,
    setDeleteModalVisible,
    deleteSuccessVisible,
    handleDeleteConfirm,
    handleResetOnboarding,
    handleSignOut,
  };
}
