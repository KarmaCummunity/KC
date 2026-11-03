// My Profile — open-posts tab. Sibling route: ./closed.tsx.
// Mapped to: FR-PROFILE-001 AC4 (open lane), FR-POST-016.
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { MyProfileChrome } from '../../../src/components/profile/MyProfileChrome';
import { ProfilePostsGrid } from '../../../src/components/profile/ProfilePostsGrid';
import { Screen } from '../../../src/components/ui/Screen';
import { useShellTabBarScrollInset } from '../../../src/navigation/useShellTabBarVisibility';
import { useAuthStore } from '../../../src/store/authStore';
import { getMyPostsUseCase } from '../../../src/services/postsComposition';
import { useMyProfilePostOwner } from '../../../src/hooks/useProfilePostOwner';
import { useScreenAside } from '../../../src/components/aside/useScreenAside';
import { ProfileStatsAside } from '../../../src/components/aside/ProfileStatsAside';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function MyProfileOpenScreen() {
  const tabBarPad = useShellTabBarScrollInset();
  const userId = useAuthStore((s) => s.session?.userId);
  const postOwner = useMyProfilePostOwner();

  // Desktop (>=1024) aside — personal stats summary (FR-RESP-003).
  useScreenAside(() => <ProfileStatsAside />, []);

  const myPostsQuery = useQuery({
    queryKey: ['my-posts', userId],
    queryFn: () =>
      getMyPostsUseCase().execute({
        userId: userId!,
        status: ['open'],
        limit: 30,
        excludeVisibility: 'OnlyMe',
      }),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000, // PERF-3: profile (self) — edit-profile invalidates explicitly
  });

  return (
    <Screen blobs="content" testID="my-profile-screen">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: tabBarPad }}
        showsVerticalScrollIndicator={false}
      >
        <MyProfileChrome activeTab="open" />
        <ProfilePostsGrid
          posts={myPostsQuery.data?.posts ?? []}
          isLoading={myPostsQuery.isLoading}
          isError={myPostsQuery.isError}
          onRetry={() => void myPostsQuery.refetch()}
          empty="self_open"
          postOwner={postOwner}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, width: '100%', alignSelf: 'stretch' },
});
