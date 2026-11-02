// My Profile — closed-posts tab. Sibling route: ./index.tsx.
// Mapped to: FR-PROFILE-001 AC4 (closed lane), FR-CLOSURE-005 AC4, FR-CLOSURE-008.
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { MyProfileChrome } from '../../../src/components/profile/MyProfileChrome';
import { ProfileClosedPostsGrid } from '../../../src/components/profile/ProfileClosedPostsGrid';
import { Screen } from '../../../src/components/ui/Screen';
import { useShellTabBarScrollInset } from '../../../src/navigation/useShellTabBarVisibility';
import { useAuthStore } from '../../../src/store/authStore';
import { useProfileClosedPosts } from '../../../src/hooks/useProfileClosedPosts';
import { useMyProfilePostOwner } from '../../../src/hooks/useProfilePostOwner';
import { useScreenAside } from '../../../src/components/aside/useScreenAside';
import { ProfileStatsAside } from '../../../src/components/aside/ProfileStatsAside';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function MyProfileClosedScreen() {
  const tabBarPad = useShellTabBarScrollInset();
  const userId = useAuthStore((s) => s.session?.userId);
  const postOwner = useMyProfilePostOwner();
  const closed = useProfileClosedPosts({ profileUserId: userId, viewerUserId: userId ?? null });

  // Desktop (>=1024) aside — personal stats summary (FR-RESP-003).
  useScreenAside(() => <ProfileStatsAside />, []);

  return (
    <Screen blobs="content">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: tabBarPad }}
        showsVerticalScrollIndicator={false}
      >
        <MyProfileChrome activeTab="closed" />
        <ProfileClosedPostsGrid
          items={closed.items}
          isLoading={closed.isLoading}
          empty="self_closed"
          hasMore={closed.hasMore}
          isLoadingMore={closed.isLoadingMore}
          onLoadMore={closed.loadMore}
          profileUserId={userId!}
          postOwner={postOwner}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, width: '100%', alignSelf: 'stretch' },
});
