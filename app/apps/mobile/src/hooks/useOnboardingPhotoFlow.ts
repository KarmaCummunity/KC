// FR-AUTH-011 — photo step state: pick/remove/finalize (keeps screen file under arch line cap).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { useOnboardingReplayStore } from '../store/onboardingReplayStore';
import {
  getCompleteOnboardingUseCase,
  getSetAvatarUseCase,
  getUserRepo,
} from '../services/userComposition';
import { retirePreviousAvatar } from '../services/avatarLifecycle';
import { isBlockedMediaPick, type MediaPermissionKind } from '../lib/mediaPermissionTypes';
import {
  pickAvatarImage,
  removeUploadedAvatar,
  resizeAndUploadAvatar,
  type AvatarSource,
} from '../services/avatarUpload';

export function useOnboardingPhotoFlow() {
  const { t } = useTranslation();
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const onboardingState = useAuthStore((s) => s.onboardingState);
  const setSession = useAuthStore((s) => s.setSession);
  const setOnboardingState = useAuthStore((s) => s.setOnboardingState);
  const [uploading, setUploading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [permissionBlocked, setPermissionBlocked] = useState<MediaPermissionKind | null>(null);

  // FR-ADMIN-035: an admin replay shows only the photo picked during the replay (none at first,
  // like a new member) and never uploads it or writes the profile.
  const replayActive = useOnboardingReplayStore((s) => s.active);
  const replayAvatarUri = useOnboardingReplayStore((s) => s.avatarPreviewUri);
  const setReplayAvatar = useOnboardingReplayStore((s) => s.setAvatarPreview);

  const avatarUrl = replayActive ? replayAvatarUri : (session?.avatarUrl ?? null);
  const hasAvatar = !!avatarUrl;
  const busy = uploading || finalizing;

  const pick = async (source: AvatarSource) => {
    if (!session) return;
    setUploading(true);
    try {
      const picked = await pickAvatarImage(source);
      if (isBlockedMediaPick(picked)) {
        setPermissionBlocked(picked.kind);
        return;
      }
      setPermissionBlocked(null);
      if (picked.status !== 'ok') return;
      if (replayActive) {
        setReplayAvatar(picked.value.uri);
        return;
      }
      const url = await resizeAndUploadAvatar(picked.value, session.userId);
      // A rejected save does not prove the profile was not updated (a lost response can follow a
      // commit), so nothing is deleted on failure here.
      await getSetAvatarUseCase().execute({
        sessionUserId: session.userId,
        userId: session.userId,
        avatarUrl: url,
      });
      setSession({ ...session, avatarUrl: url });
      const readCurrent = async () => (await getUserRepo().findById(session.userId))?.avatarUrl ?? null;
      // The replaced generation stays public unless retired (skipped on any doubt).
      void retirePreviousAvatar({
        userId: session.userId, previousUrl: session.avatarUrl, committedUrl: url, readCurrentAvatarUrl: readCurrent,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('general.unknownError');
      Alert.alert(t('onboarding.uploadFailed'), `${t('onboarding.uploadFailedBody')}\n${msg}`);
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    if (!session) return;
    if (replayActive) {
      setReplayAvatar(null);
      return;
    }
    setUploading(true);
    try {
      await removeUploadedAvatar(session.userId, session.avatarUrl); // TD-108: delete Storage object first.
      await getSetAvatarUseCase().execute({
        sessionUserId: session.userId,
        userId: session.userId,
        avatarUrl: null,
      });
      setSession({ ...session, avatarUrl: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('general.unknownError');
      Alert.alert(t('onboarding.removeFailed'), msg);
    } finally {
      setUploading(false);
    }
  };

  const finalize = async () => {
    if (!session) return;
    if (replayActive) {
      router.replace('/(onboarding)/tour');
      return;
    }
    setFinalizing(true);
    try {
      if (onboardingState === 'pending_avatar') {
        await getCompleteOnboardingUseCase().execute({ userId: session.userId });
        setOnboardingState('completed');
      }
      router.replace('/(onboarding)/tour');
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('general.unknownError');
      Alert.alert(t('onboarding.saveFailed'), msg);
    } finally {
      setFinalizing(false);
    }
  };

  const goBack = () => {
    if (busy) return;
    router.replace('/(onboarding)/basic-info');
  };

  return {
    session,
    avatarUrl,
    hasAvatar,
    uploading,
    finalizing,
    busy,
    pick,
    remove,
    finalize,
    goBack,
    permissionBlocked,
  };
}
