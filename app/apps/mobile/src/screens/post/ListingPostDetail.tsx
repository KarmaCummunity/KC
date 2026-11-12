// G1 step 4a (ADR-006) — the post detail of a listing-world post (food, rides, housing, time,
// knowledge, marketplace items): the listing's hero, type sections and type actions (reserve /
// claim / book / stay, owner management, report) shown in place at /post/[id], with the post's
// likes and comments under them, and the same share link as every other post.
import React from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import type { PostWithOwner } from '@kc/application';
import { MarketplaceListingDetailScreen } from '../marketplace/MarketplaceListingDetailScreen';
import { PostEngagementThread } from '../../components/post-detail/PostEngagementThread';
import { PostEngagementComposer } from '../../components/post-detail/PostEngagementComposer';
import { PostEngagementProvider } from '../../components/post-detail/PostEngagementContext';
import { PostMenuButton } from '../../components/post/PostMenuButton';
import { PostShareButton } from '../../components/post/PostShareButton';
import { nativeStackHeaderRightIconOnly } from '../../navigation/nativeHeaderIconOnly';
import { usePostDetailStyles } from './postDetailScreen.styles';
import { postShowsEngagementSection } from '../../lib/postEngagementVisible';
import { postDetailScrollBottomInset } from '../../components/post-detail/postDetailBottomMetrics';
import { useKeyboardVerticalOffset } from '../../lib/platform/useKeyboardVerticalOffset';
import { ListingOwnerClosureBar } from '../../components/closure/ListingOwnerClosureBar';
import { PostDetailBottomChrome } from '../../components/post-detail/PostDetailBottomChrome';
import { ListingRepublishBar } from '../../components/closure/ListingRepublishBar';
import { canRepublishListingPost } from '../../lib/unifiedCreate/listingRepublish';
import { resolveKeyboardAvoidingBehavior } from '../../lib/platform/keyboardVerticalOffset';

type Props = {
  readonly post: PostWithOwner;
  readonly listingId: string;
  readonly viewerId: string | null;
  readonly bottomInset: number;
};

export function ListingPostDetail({ post, listingId, viewerId, bottomInset }: Props) {
  const styles = usePostDetailStyles();
  const keyboardOffset = useKeyboardVerticalOffset();
  const showEngagement = Boolean(viewerId) && postShowsEngagementSection(post.status);
  const ownerCloseId = viewerId !== null
    && post.ownerId === viewerId
    && post.status === 'open'
    && post.type === 'Give'
    ? viewerId
    : null;
  // D127: an expired post is never reopened; its owner republishes it as a new post instead.
  const canRepublish = canRepublishListingPost(post, viewerId);
  const ownerSlot = ownerCloseId ? (
    <ListingOwnerClosureBar post={post} listingId={listingId} ownerId={ownerCloseId} embedded />
  ) : canRepublish ? (
    <ListingRepublishBar listingId={listingId} />
  ) : undefined;
  const showBottomChrome = Boolean(ownerSlot) || showEngagement;
  const scrollInset = postDetailScrollBottomInset({
    tabBarOverlayInset: bottomInset,
    hasOwnerBar: Boolean(ownerSlot),
    hasComposer: showEngagement,
  });

  const footer = showEngagement ? <PostEngagementThread /> : null;

  return (
    <>
      <Stack.Screen
        options={{
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
          <MarketplaceListingDetailScreen
            listingId={listingId}
            bottomInset={scrollInset}
            footer={footer}
            moderationInHeader
          />
          {showBottomChrome ? (
            <PostDetailBottomChrome
              tabBarOverlayInset={bottomInset}
              ownerSlot={ownerSlot}
              composerSlot={showEngagement ? <PostEngagementComposer embedded /> : undefined}
            />
          ) : null}
        </KeyboardAvoidingView>
      </PostEngagementProvider>
    </>
  );
}
