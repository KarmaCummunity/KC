// My Profile — one screen for both posts lanes (open / closed).
// The lane is local state, not a route: switching tabs swaps only the posts list,
// while the TopBar, profile card and tab strip stay mounted (no re-mount, no replayed
// entry animation, scroll position kept). Both lanes are fetched up front and cached
// by React Query, so a switch is instant; a loading state only ever shows in the list.
// Mapped to: FR-PROFILE-001 AC4, FR-POST-016, FR-CLOSURE-005 AC4, FR-CLOSURE-008 (#1633).
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { MyProfileChrome } from '../../components/profile/MyProfileChrome';
import { ProfilePostsGrid } from '../../components/profile/ProfilePostsGrid';
import { ProfileClosedPostsGrid } from '../../components/profile/ProfileClosedPostsGrid';
import type { ProfilePostsTab } from '../../components/profile/ProfileTabs';
import { Screen } from '../../components/ui/Screen';
import { useScreenAside } from '../../components/aside/useScreenAside';
import { ProfileStatsAside } from '../../components/aside/ProfileStatsAside';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import { useAuthStore } from '../../store/authStore';
import { getMyPostsUseCase } from '../../services/postsComposition';
import { useProfileClosedPosts } from '../../hooks/useProfileClosedPosts';
import { useMyProfilePostOwner } from '../../hooks/useProfilePostOwner';
import { getRestoredProfileTab, persistProfileTab } from '../../lib/profileTabSession';

/** `?tab=closed` (e.g. the legacy `/profile/closed` URL) wins over the session memory. */
function initialTab(tabParam: string | undefined): ProfilePostsTab {
  if (tabParam === 'closed' || tabParam === 'open') return tabParam;
  return getRestoredProfileTab('self');
}

export function MyProfileScreen() {
  const tabBarPad = useShellTabBarScrollInset();
  const userId = useAuthStore((s) => s.session?.userId);
  const postOwner = useMyProfilePostOwner();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = React.useState<ProfilePostsTab>(() => initialTab(tabParam));

  // Desktop (>=1024) aside — personal stats summary (FR-RESP-003).
  useScreenAside(() => <ProfileStatsAside />, []);

  const openPostsQuery = useQuery({
    queryKey: ['my-posts', userId],
    queryFn: () =>
      getMyPostsUseCase().execute({
        userId: userId!,
        status: ['open'],
        limit: 30,
        excludeVisibility: 'OnlyMe',
        profileOpenLinks: { viewerUserId: userId!, listMode: 'standard' },
      }),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000, // PERF-3: profile (self) — edit-profile invalidates explicitly
  });
  // Fetched with the open lane (not on first switch) so the closed tab opens instantly.
  const closed = useProfileClosedPosts({ profileUserId: userId, viewerUserId: userId ?? null });

  const changeTab = React.useCallback((next: ProfilePostsTab) => {
    persistProfileTab('self', next);
    setActiveTab(next);
  }, []);

  return (
    <Screen blobs="off" testID="my-profile-screen">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: tabBarPad }}
        showsVerticalScrollIndicator={false}
      >
        <MyProfileChrome activeTab={activeTab} onTabChange={changeTab} />
        {activeTab === 'open' ? (
          <ProfilePostsGrid
            posts={openPostsQuery.data?.posts ?? []}
            isLoading={openPostsQuery.isLoading}
            isError={openPostsQuery.isError}
            onRetry={() => void openPostsQuery.refetch()}
            empty="self_open"
            postOwner={postOwner}
          />
        ) : (
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
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, width: '100%', alignSelf: 'stretch' },
});
