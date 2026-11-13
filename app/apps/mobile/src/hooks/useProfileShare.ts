// FR-POST-023 — share sheet orchestration for a profile (⋮ menu of the own and other profiles).
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveWebBaseUrl } from '../lib/buildPostShareUrl';
import { buildProfileShareMessage, buildProfileShareUrl } from '../lib/buildProfileShare';
import { hapticLightTap, hapticSuccess } from '../lib/haptics';
import { shareLink } from '../lib/sharePost';
import { useFeedSessionStore } from '../store/feedSessionStore';

/** What a profile share needs: the public handle (the link) and the name the profile shows. */
export interface ProfileShareSubject {
  readonly shareHandle: string;
  readonly displayName: string | null;
}

export function useProfileShare(profile: ProfileShareSubject | undefined) {
  const { t } = useTranslation();
  const showToast = useFeedSessionStore((s) => s.showEphemeralToast);
  const [busy, setBusy] = useState(false);

  const share = useCallback(async () => {
    if (busy || !profile) return;
    hapticLightTap();
    setBusy(true);
    try {
      const webBaseUrl = resolveWebBaseUrl({ EXPO_PUBLIC_WEB_BASE_URL: process.env.EXPO_PUBLIC_WEB_BASE_URL });
      const outcome = await shareLink({
        url: buildProfileShareUrl(profile.shareHandle, webBaseUrl),
        title: t('share.dialogTitle'),
        message: buildProfileShareMessage({ displayName: profile.displayName }, t),
        imageKey: `profile-${profile.shareHandle}`,
      });
      if (outcome.kind === 'shared' || outcome.kind === 'copied') hapticSuccess();
      if (outcome.kind === 'copied') showToast(t('share.copiedToast'), 'success', 1800);
      else if (outcome.kind === 'failed') showToast(t('share.failedToast'), 'error', 2200);
    } catch (err) {
      console.warn('[useProfileShare] share failed', err);
      showToast(t('share.failedToast'), 'error', 2200);
    } finally {
      setBusy(false);
    }
  }, [busy, profile, showToast, t]);

  return { share, busy, canShare: profile !== undefined };
}
