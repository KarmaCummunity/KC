// G1 step 4a (ADR-006) — the post detail of a listing-world post (food, rides, housing, time,
// knowledge, marketplace items): the listing's hero, type sections and type actions (reserve /
// claim / book / stay, owner management, report) shown in place at /post/[id], with the post's
// likes and comments under them, and the same share link as every other post.
import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import type { PostWithOwner } from '@kc/application';
import { MarketplaceListingDetailScreen } from '../marketplace/MarketplaceListingDetailScreen';
import { PostEngagementSection } from '../../components/post-detail/PostEngagementSection';
import { PostShareButton } from '../../components/post/PostShareButton';
import { nativeStackHeaderRightIconOnly } from '../../navigation/nativeHeaderIconOnly';
import { usePostDetailStyles } from './postDetailScreen.styles';

type Props = {
  readonly post: PostWithOwner;
  readonly listingId: string;
  readonly viewerId: string | null;
  readonly bottomInset: number;
};

export function ListingPostDetail({ post, listingId, viewerId, bottomInset }: Props) {
  const styles = usePostDetailStyles();
  // Likes and comments follow the post page's rule: only while the post is open (FR-POST-014).
  const engagement =
    post.status === 'open' ? <PostEngagementSection postId={post.postId} viewerId={viewerId} /> : null;

  return (
    <>
      <Stack.Screen
        options={{
          // The listing view carries its own report action, so the header holds only the share.
          ...nativeStackHeaderRightIconOnly(() => (
            <View style={styles.headerActions}>
              <PostShareButton post={post} placement="header" />
            </View>
          )),
        }}
      />
      <MarketplaceListingDetailScreen listingId={listingId} bottomInset={bottomInset} footer={engagement} />
    </>
  );
}
