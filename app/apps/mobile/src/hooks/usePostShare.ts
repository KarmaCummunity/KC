// FR-POST-023 — share sheet orchestration (header button + post ⋮ menu).
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import type { PostWithOwner } from '@kc/application';
import { getSupabaseClient } from '@kc/infrastructure-supabase';
import { canSharePost } from '../lib/canSharePost';
import { resolveWebBaseUrl } from '../lib/buildPostShareUrl';
import { resolveDateFnsLocale } from '../lib/resolveDateFnsLocale';
import { sharePost } from '../lib/sharePost';
import { buildPostShareMessage } from '../lib/buildPostShareMessage';
import { resolvePostShareKind } from '../lib/postShareKind';
import { postOwnerDisplayLabel } from '../lib/postOwnerDisplayLabel';
import { postRecipientDisplayLabel } from '../lib/postRecipientDisplayLabel';
import { useAuthStore } from '../store/authStore';
import { useFeedSessionStore } from '../store/feedSessionStore';
import { hapticLightTap, hapticSuccess } from '../lib/haptics';

export function usePostShare(post: PostWithOwner) {
  const { t, i18n } = useTranslation();
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const showToast = useFeedSessionStore((s) => s.showEphemeralToast);
  const [busy, setBusy] = useState(false);
  const canShare = canSharePost(post, viewerId);
  const publisherLabel = postOwnerDisplayLabel(post, t);

  const share = useCallback(async () => {
    if (busy || !canShare) return;
    hapticLightTap();
    setBusy(true);
    try {
      const webBaseUrl = resolveWebBaseUrl({
        EXPO_PUBLIC_WEB_BASE_URL: process.env.EXPO_PUBLIC_WEB_BASE_URL,
      });
      const postedAt = formatDistanceToNow(new Date(post.createdAt), {
        addSuffix: true,
        locale: resolveDateFnsLocale(i18n.language),
      });
      const kind = resolvePostShareKind({
        type: post.type,
        status: post.status,
        listingWorldSlug: post.listingWorldSlug,
        challengeId: post.challengeId,
      });
      const recipientNavigable = (post.recipientProfileNavigableFromPost ?? true) === true;
      const counterpartyLabel =
        kind.lifecycle === 'closed' && post.recipientUser
          ? postRecipientDisplayLabel(post.recipientUser, recipientNavigable, t)
          : null;
      const message = buildPostShareMessage(
        {
          kind,
          title: post.title,
          description: post.description,
          category: post.category,
          address: post.address,
          locationDisplayLevel: post.locationDisplayLevel,
          postedAt,
          publisherLabel,
          counterpartyLabel,
        },
        t,
      );
      const firstAsset = post.mediaAssets[0];
      // The photo lives in the bucket its asset names: a feed mirror of a listing borrows the
      // listing's photos from `listing-images`, so a hard-coded bucket would share a dead link.
      const remoteImageUrl = firstAsset
        ? getSupabaseClient().storage
            .from(firstAsset.bucket)
            .getPublicUrl(firstAsset.path).data.publicUrl
        : undefined;
      const outcome = await sharePost({
        postId: post.postId,
        title: post.title,
        message,
        webBaseUrl,
        remoteImageUrl,
      });
      if (outcome.kind === 'shared' || outcome.kind === 'copied') hapticSuccess();
      if (outcome.kind === 'copied') {
        showToast(t('share.copiedToast'), 'success', 1800);
      } else if (outcome.kind === 'failed') {
        showToast(t('share.failedToast'), 'error', 2200);
      }
    } catch (err) {
      console.warn('[usePostShare] share failed', err);
      showToast(t('share.failedToast'), 'error', 2200);
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    canShare,
    post.postId,
    post.title,
    post.type,
    post.status,
    post.listingWorldSlug,
    post.challengeId,
    post.description,
    post.category,
    post.address,
    post.locationDisplayLevel,
    post.createdAt,
    post.mediaAssets,
    publisherLabel,
    post.recipientUser,
    post.recipientProfileNavigableFromPost,
    showToast,
    t,
    i18n.language,
  ]);

  return { canShare, share, busy };
}
