// Post detail — wired to live IPostRepository (P0.4-FE).
// Mapped to: FR-POST-014, FR-POST-015, FR-POST-021, FR-POST-023, FR-CHAT-004, FR-CHAT-005. Closes TD-32 / AUDIT-P2-09.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, TouchableOpacity, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { resolveDateFnsLocale } from '../../lib/resolveDateFnsLocale';
import { useTheme, Text, iconSize } from '@kc/ui';
import { EmptyState } from '../../components/EmptyState';
import { useAuthStore } from '../../store/authStore';
import { getPostByIdUseCase } from '../../services/postsComposition';
import { contactPoster } from '../../lib/contactPoster';
import { postOwnerDisplayLabel } from '../../lib/postOwnerDisplayLabel';
import { useFeedSessionStore } from '../../store/feedSessionStore';
import { OwnerActionsBar } from '../../components/closure/OwnerActionsBar';
import { PostMenuButton } from '../../components/post/PostMenuButton';
import { PostShareButton } from '../../components/post/PostShareButton';
import { PostDetailScrollContent } from './PostDetailScrollContent';
import { usePostDetailStyles } from './postDetailScreen.styles';
import { finishMark, startMark } from '../../lib/observability/perfMarks';
import {
  useShellTabBarVisibility,
  shellTabBarHeightPx,
} from '../../navigation/useShellTabBarVisibility';
import { ListingPostDetail } from './ListingPostDetail';
import { ownerBarTabClearance } from '../../components/shell/tabBarGeometry';
import { nativeStackHeaderRightIconOnly } from '../../navigation/nativeHeaderIconOnly';
import { PostEngagementProvider } from '../../components/post-detail/PostEngagementContext';
import { PostEngagementComposer } from '../../components/post-detail/PostEngagementComposer';
import { PostDetailBottomChrome } from '../../components/post-detail/PostDetailBottomChrome';
import { postDetailScrollBottomInset } from '../../components/post-detail/postDetailBottomMetrics';
import { useKeyboardVerticalOffset } from '../../lib/platform/useKeyboardVerticalOffset';
import { postShowsEngagementSection } from '../../lib/postEngagementVisible';
import { useSeededFeedPost } from '../../hooks/useSeededFeedPost';
import { postLocationText } from '../../lib/postLocationText';
import { resolveKeyboardAvoidingBehavior } from '../../lib/platform/keyboardVerticalOffset';

function normalizeRoutePostId(raw: string | string[] | undefined): string | undefined {
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (typeof id !== 'string') return undefined;
  const trimmed = id.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return undefined;
  return trimmed;
}

function normalizeOptionalUserId(raw: string | string[] | undefined): string | null {
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
  return trimmed;
}


export function PostDetailScreen() {
  const styles = usePostDetailStyles();
  const { colors } = useTheme();
  const { id: rawId, fromProfile: rawFromProfile } = useLocalSearchParams<{
    id?: string | string[];
    fromProfile?: string | string[];
  }>();
  const postIdParam = normalizeRoutePostId(rawId);
  const identityListingHostUserId = normalizeOptionalUserId(rawFromProfile);
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const seed = useSeededFeedPost(postIdParam, viewerId, identityListingHostUserId);

  const query = useQuery({
    queryKey: ['post', postIdParam, viewerId, identityListingHostUserId ?? ''],
    queryFn: () =>
      getPostByIdUseCase().execute({
        postId: postIdParam ?? '',
        viewerId,
        identityListingHostUserId,
      }),
    enabled: Boolean(postIdParam),
    staleTime: 60_000, // PERF-3: post detail — closure/edit actions invalidate explicitly
    // Same row the feed or closed-profile list already loaded. Fresh copies skip
    // the extra posts + identity reads; a stale copy still paints immediately.
    ...(seed ? { initialData: { post: seed.post }, initialDataUpdatedAt: seed.updatedAt } : {}),
  });
  // NFR-PERF-005: how long a member waits from opening a post to seeing its content (cached or fetched).
  const hasPost = Boolean(query.data?.post);
  useEffect(() => {
    startMark('post_detail.content_painted');
  }, [postIdParam]);
  useEffect(() => {
    if (hasPost) finishMark('post_detail.content_painted');
  }, [hasPost, postIdParam]);
  const challengeId = query.data?.post?.challengeId ?? null;
  useEffect(() => {
    if (!challengeId) return;
    router.replace({
      pathname: '/(tabs)/donations/challenges/[challengeId]',
      params: { challengeId },
    });
  }, [challengeId, router]);

  const [contactPosterBusy, setContactPosterBusy] = useState(false);
  const onOpenPosterChat = useCallback(async () => {
    if (!viewerId) return;
    const p = query.data?.post;
    if (!p) return;
    setContactPosterBusy(true);
    try {
      await contactPoster(viewerId, p, router);
    } finally {
      setContactPosterBusy(false);
    }
  }, [viewerId, query.data?.post, router]);

  const showShellTabBar = useShellTabBarVisibility();
  const tabBarPad = shellTabBarHeightPx(showShellTabBar);
  const safeBottom = useSafeAreaInsets().bottom;
  // The centre "+" rises above the bar and covers a full-width action docked on it.
  const ownerDockInset = showShellTabBar ? ownerBarTabClearance(tabBarPad, safeBottom) : 0;
  const keyboardOffset = useKeyboardVerticalOffset();

  const exitAfterOwnerMutation = (messageKey: 'closure.detailCloseSuccessToast' | 'closure.detailReopenSuccessToast') => {
    useFeedSessionStore.getState().showEphemeralToast(t(messageKey), 'success', 2200);
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  if (query.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (query.isError && !query.data?.post) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>{t('post.detail.loadErrorTitle')}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => query.refetch()}>
          <Text style={styles.retryText}>{t('post.detail.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  const post = query.data?.post;
  if (post?.challengeId) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!post) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          icon="search-outline"
          title={t('post.detail.notFoundTitle')}
          subtitle={t('post.detail.notFoundSubtitle')}
        />
      </SafeAreaView>
    );
  }

  // G1 step 4a: a post of a listing world shows its listing's sections and actions in place.
  if (post.listingId) {
    return (
      <ListingPostDetail post={post} listingId={post.listingId} viewerId={viewerId} bottomInset={ownerDockInset} />
    );
  }

  // FR-POST-015 AC1: owner-mode CTAs vs viewer's "Send Message to Poster" (FR-POST-014 AC6: open only).
  const isOwner = viewerId !== null && post.ownerId === viewerId;
  const isGive = post.type === 'Give';
  const locationText = postLocationText(post, t('post.detail.streetPrefix'));
  const timeAgo = formatDistanceToNow(new Date(post.createdAt), {
    addSuffix: true,
    locale: resolveDateFnsLocale(i18n?.language ?? 'he'),
  });

  const showViewerContactCta = !isOwner && post.status === 'open';
  const showEngagementComposer = Boolean(viewerId) && postShowsEngagementSection(post.status);
  const showOwnerChrome = isOwner && viewerId !== null;
  const scrollBottomInset = postDetailScrollBottomInset({
    tabBarOverlayInset: ownerDockInset,
    hasOwnerBar: showOwnerChrome,
    hasComposer: showEngagementComposer,
  });

  const ownerNavigable = post.ownerProfileNavigableFromPost !== false;
  const ownerLabel = postOwnerDisplayLabel(post, t);

  const contactPill = (
    <TouchableOpacity
      style={styles.messageBtn}
      activeOpacity={0.85}
      onPress={() => void onOpenPosterChat()}
      disabled={contactPosterBusy}
      accessibilityRole="button"
      accessibilityState={{ busy: contactPosterBusy }}
      accessibilityLabel={
        contactPosterBusy ? t('post.detail.contactOpeningA11y') : t('post.detail.contactA11y')
      }
    >
      {contactPosterBusy ? (
        <ActivityIndicator size="small" color={colors.textInverse} />
      ) : (
        <>
          <Ionicons name="chatbubble-outline" size={iconSize.md} color={colors.textInverse} />
          <Text style={styles.messageBtnText}>{t('post.detail.contactCta')}</Text>
        </>
      )}
    </TouchableOpacity>
  );

  return (
    // testID: stable E2E anchor for "the loaded post opened" (Maestro flow 06, KC#1235).
    <SafeAreaView
      style={styles.container}
      edges={showEngagementComposer ? [] : ['bottom']}
      testID="post-detail-screen"
    >
      <Stack.Screen
        options={{
          // Under forceRTL=true, the inner row visually flips so the *first*
          // child lands at the screen's right edge (= the corner). Share is
          // first so it sits in the corner, with the ⋮ menu to its left.
          ...nativeStackHeaderRightIconOnly(() => (
            <View style={styles.headerActions}>
              <PostShareButton post={post} placement="header" />
              <PostMenuButton post={post} placement="header" showShareInMenu={false} />
            </View>
          )),
        }}
      />
      <PostEngagementProvider postId={post.postId} viewerId={viewerId}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={resolveKeyboardAvoidingBehavior(Platform.OS)}
          keyboardVerticalOffset={keyboardOffset}
        >
          <PostDetailScrollContent
            post={post}
            isGive={isGive}
            viewerId={viewerId}
            ownerNavigable={ownerNavigable}
            ownerLabel={ownerLabel}
            locationText={locationText}
            timeAgo={timeAgo}
            scrollBottomInset={scrollBottomInset}
          />
          {showEngagementComposer || showOwnerChrome || showViewerContactCta ? (
            <PostDetailBottomChrome
              tabBarOverlayInset={ownerDockInset}
              floatingSlot={showViewerContactCta ? contactPill : undefined}
              ownerSlot={
                showOwnerChrome ? (
                  <OwnerActionsBar
                    post={post}
                    ownerId={viewerId!}
                    embedded
                    onClosed={() => exitAfterOwnerMutation('closure.detailCloseSuccessToast')}
                    onReopened={() => exitAfterOwnerMutation('closure.detailReopenSuccessToast')}
                  />
                ) : undefined
              }
              composerSlot={
                showEngagementComposer ? <PostEngagementComposer embedded /> : undefined
              }
            />
          ) : null}
        </KeyboardAvoidingView>
      </PostEngagementProvider>
    </SafeAreaView>
  );
}

export default PostDetailScreen;
