// FR-POST-023 — share sheet orchestration (header button + post ⋮ menu).
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import type { PostWithOwner } from '@kc/application';
import { getSupabaseClient } from '@kc/infrastructure-supabase';
import { canSharePost } from '../lib/canSharePost';
import { resolveWebBaseUrl } from '../lib/buildPostShareUrl';
import { resolveDateFnsLocale } from '../lib/resolveDateFnsLocale';
import { sharePost } from '../lib/sharePost';
import { buildPostShareMessage } from '../lib/buildPostShareMessage';
import { postOwnerDisplayLabel } from '../lib/postOwnerDisplayLabel';
import { postRecipientDisplayLabel } from '../lib/postRecipientDisplayLabel';
import { useAuthStore } from '../store/authStore';
import { useFeedSessionStore } from '../store/feedSessionStore';
import { hapticLightTap, hapticSuccess } from '../lib/haptics';

const POST_IMAGES_BUCKET = 'post-images';

export function usePostShare(post: PostWithOwner) {
  const { t, i18n } = useTranslation();
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const showToast = useFeedSessionStore((s) => s.showEphemeralToast);
  const [busy, setBusy] = useState(false);
  const postRef = useRef(post);
  postRef.current = post;
  const canShare = canSharePost(post, viewerId);

  const share = useCallback(async () => {
    const currentPost = postRef.current;
    if (busy || !canShare) return;
    hapticLightTap();
    setBusy(true);
    try {
      const webBaseUrl = resolveWebBaseUrl({
        EXPO_PUBLIC_WEB_BASE_URL: process.env.EXPO_PUBLIC_WEB_BASE_URL,
      });
      const postedAt = formatDistanceToNow(new Date(currentPost.createdAt), {
        addSuffix: true,
        locale: resolveDateFnsLocale(i18n.language),
      });
      const shareStatus = currentPost.status === 'closed_delivered' ? 'closed_delivered' : 'open';
      const recipientNavigable = (currentPost.recipientProfileNavigableFromPost ?? true) === true;
      const counterpartyLabel =
        shareStatus === 'closed_delivered' && currentPost.recipientUser
          ? postRecipientDisplayLabel(currentPost.recipientUser, recipientNavigable, t)
          : null;
      const message = buildPostShareMessage(
        {
          type: currentPost.type,
          status: shareStatus,
          title: currentPost.title,
          description: currentPost.description,
          category: currentPost.category,
          address: currentPost.address,
          locationDisplayLevel: currentPost.locationDisplayLevel,
          postedAt,
          publisherLabel: postOwnerDisplayLabel(currentPost, t),
          counterpartyLabel,
        },
        t,
      );
      const firstAsset = currentPost.mediaAssets[0];
      const remoteImageUrl = firstAsset
        ? getSupabaseClient().storage
            .from(POST_IMAGES_BUCKET)
            .getPublicUrl(firstAsset.path).data.publicUrl
        : undefined;
      const outcome = await sharePost({
        postId: currentPost.postId,
        title: currentPost.title,
        message,
        webBaseUrl,
        remoteImageUrl,
      });
      if (outcome.kind === 'shared' || outcome.kind === 'copied') hapticSuccess();
      if (outcome.kind === 'copied') {
        showToast(t('post.detail.shareCopiedToast'), 'success', 1800);
      } else if (outcome.kind === 'failed') {
        showToast(t('post.detail.shareFailedToast'), 'error', 2200);
      }
    } catch (err) {
      console.warn('[usePostShare] share failed', err);
      showToast(t('post.detail.shareFailedToast'), 'error', 2200);
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    canShare,
    showToast,
    t,
    i18n.language,
  ]);

  return { canShare, share, busy };
}
