// Async actions + modal state for `app/settings.tsx` (keeps screen under arch line cap).
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getDeleteAccountUseCase } from '../services/userComposition';
import { performFullSignOut } from '../services/performFullSignOut';
import { useAuthStore } from '../store/authStore';
import { container } from '../lib/container';

export function useSettingsAccountActions() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOutLocal = useAuthStore((s) => s.signOut);
  const [signingOut, setSigningOut] = useState(false);
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
    deleteModalVisible,
    setDeleteModalVisible,
    deleteSuccessVisible,
    handleDeleteConfirm,
    handleSignOut,
  };
}
