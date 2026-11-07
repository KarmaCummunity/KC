// FR-CHAT-014 + FR-CHAT-015 — sticky anchored-post card; ClosureSheet + explainer render here for chat-initiated closure.
import { useEffect, useMemo } from 'react';
import { Linking, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, radius, spacing, typography, iconSize, useTheme, Text } from '@kc/ui';
import type { GestureResponderEvent } from 'react-native';
import type { PostType } from '@kc/domain';
import { getPostByIdUseCase } from '../../services/postsComposition';
import { getUserRepo } from '../../services/userComposition';
import { useChatStore } from '../../store/chatStore';
import { useClosureStore } from '../../store/closureStore';
import { ClosureSheet } from '../closure/ClosureSheet';
import { ClosureExplainerSheet } from '../closure/ClosureExplainerSheet';
import { invalidatePersonalStatsCaches } from '../../lib/invalidatePersonalStatsCaches';
import { invalidateMyProfilePostQueries } from '../../lib/invalidateMyProfilePostQueries';
import { trackSocialHandoverCompleted } from '../../lib/trackSocialHandoverCompleted';
import { hapticSuccess } from '../../lib/haptics';
import { KcRowCard } from '../cards/KcRowCard';
import { cleanDisplayTitle } from '../../lib/displayTitle';
import { getSupabaseImageThumbUrl, getSupabasePublicImageUrl } from '../../lib/imageUrl';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { listingOwnerMarkCtaKey } from '../../lib/listingOwnerClosure';

interface Props {
  chatId: string;
  anchorPostId: string | null;
  viewerId: string;
  /** Null when the counterpart has deleted their account (FK SET NULL since migration 0028). */
  counterpartId: string | null;
}

const TYPE_LABEL_KEYS: Record<PostType, string> = {
  Give: 'chat.anchoredTypeGive',
  Request: 'chat.anchoredTypeRequest',
};

export function AnchoredPostCard({ chatId, anchorPostId, viewerId, counterpartId }: Props) {
  const { t } = useTranslation();
  const styles = useAnchoredPostCardStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const startClosure = useClosureStore((s) => s.start);
  const closureStep = useClosureStore((s) => s.step);
  const closureInitiator = useClosureStore((s) => s.initiator);
  const resetClosure = useClosureStore((s) => s.reset);
  const messages = useChatStore((s) => s.threads[chatId]);

  const query = useQuery({
    queryKey: ['post', anchorPostId, viewerId],
    queryFn: () => getPostByIdUseCase().execute({ postId: anchorPostId!, viewerId }),
    enabled: Boolean(anchorPostId),
    staleTime: 60_000, // PERF-3: chat anchored post — closure event invalidates explicitly
  });

  // FR-CHAT-014 AC7 — counterpart contact phone via chat-scoped RPC (TD-163).
  const counterpartPhoneQuery = useQuery({
    queryKey: ['chat-counterparty-contact', chatId],
    queryFn: () => getUserRepo().getChatCounterpartyContact(chatId),
    enabled: Boolean(counterpartId),
    staleTime: 60_000,
  });
  const counterpartPhone = counterpartPhoneQuery.data ?? null;

  // When a `post_closed` system message lands in this chat, invalidate the
  // post query so the card hides — but only when there is no active closure
  // in progress (mid-closure the query will be invalidated by the done handler
  // below, after the explainer sheet is dismissed).
  const sawPostClosedSysMsg = useMemo(() => {
    if (!messages || !anchorPostId) return false;
    return messages.some(
      (m) =>
        m.kind === 'system' &&
        m.systemPayload != null &&
        (m.systemPayload as Record<string, unknown>).kind === 'post_closed' &&
        (m.systemPayload as Record<string, unknown>).post_id === anchorPostId,
    );
  }, [messages, anchorPostId]);

  useEffect(() => {
    if (sawPostClosedSysMsg && closureStep === 'idle') {
      void queryClient.invalidateQueries({ queryKey: ['post', anchorPostId] });
      invalidateMyProfilePostQueries(queryClient, viewerId);
      invalidatePersonalStatsCaches(queryClient, viewerId);
    }
  }, [sawPostClosedSysMsg, closureStep, anchorPostId, viewerId, queryClient]);

  const post = query.data?.post ?? null;

  // When closure was initiated from this chat card, handle the done state here.
  // OwnerActionsBar (post-detail context) guards its own handler so it won't
  // fire for chat-initiated closures.
  useEffect(() => {
    if (closureStep === 'done' && closureInitiator === 'chat') {
      if (post) {
        hapticSuccess();
        trackSocialHandoverCompleted(post);
      }
      resetClosure();
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      invalidateMyProfilePostQueries(queryClient, viewerId);
      void queryClient.invalidateQueries({ queryKey: ['post', anchorPostId] });
      invalidatePersonalStatsCaches(queryClient, viewerId);
    }
  }, [closureStep, closureInitiator, resetClosure, queryClient, anchorPostId, viewerId, post]);

  const isOwner = post ? post.ownerId === viewerId : false;

  // FR-CHAT-014 AC3/AC4: hide card when there is no open post. Keep the
  // component mounted (for modals) while a chat-initiated closure is in
  // flight so the ClosureExplainerSheet is not unmounted mid-flow.
  const showCard = Boolean(anchorPostId && post && post.status === 'open');
  const isActiveChatClosure = closureInitiator === 'chat' && closureStep !== 'idle';

  if (!showCard && !isActiveChatClosure) return null;

  const typeLabel = post ? t(TYPE_LABEL_KEYS[post.type]) : '';
  const isGive = post?.type === 'Give';
  const ctaText = !post
    ? ''
    : t(post.type === 'Request' ? 'closure.markRequestCta' : listingOwnerMarkCtaKey(post.listingWorldSlug));

  const path0 = post?.mediaAssets[0]?.path;
  const thumbUri = path0 ? getSupabaseImageThumbUrl({ bucket: 'post-images', path: path0 }) : null;
  const fullUri = path0 ? getSupabasePublicImageUrl({ bucket: 'post-images', path: path0 }) : null;

  const openPost = () => {
    if (!post) return;
    router.push({ pathname: '/post/[id]', params: { id: post.postId } });
  };

  const handleCall = (e: GestureResponderEvent) => {
    e.stopPropagation();
    if (!counterpartPhone) return;
    void Linking.openURL(`tel:${counterpartPhone}`);
  };

  const handleClose = (e: GestureResponderEvent) => {
    e.stopPropagation();
    if (!post) return;
    void startClosure(post.postId, viewerId, post.type, {
      // Skip preselection when counterpart was deleted — closure picker stays empty.
      ...(counterpartId != null ? { preselectedRecipientId: counterpartId } : {}),
      initiator: 'chat',
      worldSlug: post.listingWorldSlug,
    });
  };

  return (
    <>
      {showCard ? (
        <KcRowCard
          testID="chat-anchored-post"
          containerStyle={styles.banner}
          onPress={openPost}
          accessibilityLabel={t('chat.anchoredOpenA11y')}
          tone={isGive ? 'give' : 'request'}
          badgeLabel={typeLabel}
          placeholderIcon={isGive ? 'gift-outline' : 'search-outline'}
          imageUri={thumbUri}
          fallbackUri={fullUri}
          title={cleanDisplayTitle(post!.title)}
          openLinkLabel={t('cards.openFullPost')}
          trailing={isOwner ? (
            <Pressable
              onPress={handleClose}
              style={styles.cta}
              accessibilityRole="button"
              accessibilityLabel={ctaText}
            >
              <Text style={styles.ctaText}>{ctaText}</Text>
            </Pressable>
          ) : null}
          footer={counterpartPhone ? (
            <Pressable
              onPress={handleCall}
              style={styles.phoneRow}
              accessibilityRole="link"
              accessibilityLabel={t('chat.anchoredCallCounterpartA11y', { phone: counterpartPhone })}
              hitSlop={6}
            >
              <Ionicons name="call" size={iconSize.xs} color={colors.primary} />
              <Text style={styles.phoneText} numberOfLines={1}>
                {counterpartPhone}
              </Text>
            </Pressable>
          ) : null}
        />
      ) : null}
      {(isOwner || isActiveChatClosure) ? (
        <>
          <ClosureSheet />
          <ClosureExplainerSheet />
        </>
      ) : null}
    </>
  );
}

const useAnchoredPostCardStyles = makeUseStyles(({ colors }) => ({
  banner: { marginHorizontal: spacing.base, marginTop: spacing.sm },
  phoneRow: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.xs,
  },
  phoneText: {
    ...typography.caption,
    color: colors.primary,
    ...typography.semiBold,
    textDecorationLine: 'underline',
  },
  cta: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexShrink: 0,
  },
  ctaText: { ...typography.button, color: colors.textInverse },
}));
