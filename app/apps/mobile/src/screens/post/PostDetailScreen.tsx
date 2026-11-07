// Post detail — wired to live IPostRepository (P0.4-FE).
// Mapped to: FR-POST-014, FR-POST-015, FR-POST-021, FR-POST-023, FR-CHAT-004, FR-CHAT-005. Closes TD-32 / AUDIT-P2-09.
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { resolveDateFnsLocale } from '../../lib/resolveDateFnsLocale';
import type { PostWithOwner } from '@kc/application';
import { spacing, useTheme, Text, iconSize } from '@kc/ui';
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
import {
  useShellTabBarVisibility,
  useShellTabBarScrollInset,
  shellTabBarHeightPx,
} from '../../navigation/useShellTabBarVisibility';
import { ListingPostDetail } from './ListingPostDetail';
import { nativeStackHeaderRightIconOnly } from '../../navigation/nativeHeaderIconOnly';

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

function postLocationDisplayText(post: PostWithOwner, t: (key: string) => string): string {
  if (post.locationDisplayLevel === 'CityOnly') return post.address.cityName;
  if (post.locationDisplayLevel === 'CityAndStreet')
    return `${post.address.cityName}, ${t('post.detail.streetPrefix')} ${post.address.street}`;
  return `${post.address.cityName}, ${post.address.street} ${post.address.streetNumber}`;
}

// Floating CTA height (48) + bottom offset + visual buffer; reserved as scroll
// inset so the last content rows are not hidden behind the pill.
const FLOATING_CTA_RESERVED_HEIGHT = 84;

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
  });

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
  // KC#1387: the floating CTA is absolutely positioned, so the SafeAreaView's
  // bottom padding does not lift it. Its offset must include the safe-area
  // inset the docked bar extends under, or the bar covers the button.
  const ctaBottom = useShellTabBarScrollInset(spacing.base);

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
  if (query.isError) {
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
      <ListingPostDetail post={post} listingId={post.listingId} viewerId={viewerId} bottomInset={tabBarPad} />
    );
  }

  // FR-POST-015 AC1: owner-mode CTAs vs viewer's "Send Message to Poster" (FR-POST-014 AC6: open only).
  const isOwner = viewerId !== null && post.ownerId === viewerId;
  const isGive = post.type === 'Give';
  const locationText = postLocationDisplayText(post, t);
  const timeAgo = formatDistanceToNow(new Date(post.createdAt), {
    addSuffix: true,
    locale: resolveDateFnsLocale(i18n?.language ?? 'he'),
  });

  const showViewerContactCta = !isOwner && post.status === 'open';
  // Floating CTA overlaps content; reserve space so the last rows stay readable.
  const scrollBottomInset = tabBarPad + (showViewerContactCta ? FLOATING_CTA_RESERVED_HEIGHT : 0);

  const ownerNavigable = post.ownerProfileNavigableFromPost !== false;
  const ownerLabel = postOwnerDisplayLabel(post, t);

  return (
    // testID: stable E2E anchor for "the loaded post opened" (Maestro flow 06, KC#1235).
    <SafeAreaView style={styles.container} edges={['bottom']} testID="post-detail-screen">
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

      {isOwner && viewerId ? (
        <OwnerActionsBar
          post={post}
          ownerId={viewerId}
          tabBarOverlayInset={tabBarPad}
          // onClosed / onReopened: toast + leave detail (lists invalidated in OwnerActionsBar).
          onClosed={() => exitAfterOwnerMutation('closure.detailCloseSuccessToast')}
          onReopened={() => exitAfterOwnerMutation('closure.detailReopenSuccessToast')}
        />
      ) : null}
      {showViewerContactCta ? (
        <View
          style={[styles.cta, { bottom: ctaBottom }]}
          pointerEvents="box-none"
        >
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
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export default PostDetailScreen;
