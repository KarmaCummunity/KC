// FR-PROFILE-007 — pick + upload of a new avatar on the edit-profile screen, with a lifecycle that
// cannot leak a public object. The upload is aborted when the screen goes away; if the server
// committed it anyway and the URL comes back after that, the URL is never handed to the (gone)
// form: the generation is discarded (re-reading the profile first, avatarLifecycle.ts).
// `onUploadingChange` lets the screen block Save while an upload is running.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pickAvatarImage, resizeAndUploadAvatar, type AvatarSource } from '../services/avatarUpload';
import { discardUnsavedAvatar } from '../services/avatarLifecycle';
import { getUserRepo } from '../services/userComposition';

interface Args {
  readonly userId: string;
  /** The new avatar URL, only while the screen is still mounted. */
  readonly onChange: (next: string) => void;
  readonly onUploadingChange?: (uploading: boolean) => void;
}

export function useAvatarUploadTask({ userId, onChange, onUploadingChange }: Args) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const setBusy = useCallback((busy: boolean) => {
    if (!mounted.current) return;
    setUploading(busy);
    onUploadingChange?.(busy);
  }, [onUploadingChange]);

  const pickAndUpload = useCallback(async (source: AvatarSource) => {
    setBusy(true);
    const task = new AbortController();
    controller.current = task;
    try {
      const picked = await pickAvatarImage(source);
      if (!picked || !mounted.current) return;
      const url = await resizeAndUploadAvatar(picked, userId, { signal: task.signal });
      if (mounted.current && !task.signal.aborted) {
        onChange(url);
        return;
      }
      // Stored after the screen closed: nobody will ever reference it.
      void discardUnsavedAvatar({
        userId,
        uploadedUrl: url,
        readCurrentAvatarUrl: async () => (await getUserRepo().findById(userId))?.avatarUrl ?? null,
      });
    } catch (err) {
      // TD-138: `Alert.alert` is a no-op on react-native-web@0.21.2 — the screen shows a NotifyModal.
      if (mounted.current) setErrorMsg(err instanceof Error ? err.message : t('profile.avatarUploadRetry'));
    } finally {
      if (controller.current === task) controller.current = null;
      setBusy(false);
    }
  }, [onChange, setBusy, t, userId]);

  return { uploading, errorMsg, setErrorMsg, pickAndUpload };
}
