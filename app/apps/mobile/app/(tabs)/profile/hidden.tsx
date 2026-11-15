// My Profile — OnlyMe (hidden) posts. Stack header + title from `profile/_layout.tsx`.
// Mapped to: FR-PROFILE-001 AC4 (Hidden overflow entry).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, iconSize, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { ProfilePostsGrid } from '../../../src/components/profile/ProfilePostsGrid';
import { ProfileClosedPostsGrid } from '../../../src/components/profile/ProfileClosedPostsGrid';
import { useShellTabBarScrollInset } from '../../../src/navigation/useShellTabBarVisibility';
import { useAuthStore } from '../../../src/store/authStore';
import { getMyPostsUseCase } from '../../../src/services/postsComposition';
import { useProfileClosedPosts } from '../../../src/hooks/useProfileClosedPosts';
import { useMyProfilePostOwner } from '../../../src/hooks/useProfilePostOwner';
import { rowDirectionStart } from '../../../src/lib/rtlLayout';
import { rtlTextAlignStart } from '../../../src/lib/rtlTextAlignStart';

export default function MyProfileHiddenScreen() {
  const styles = useStyles();
  const tabBarPad = useShellTabBarScrollInset();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.session?.userId);
  const postOwner = useMyProfilePostOwner();

  const hiddenOpenQuery = useQuery({
    queryKey: ['my-hidden-open-posts', userId],
    queryFn: () =>
      getMyPostsUseCase().execute({
        userId: userId!,
        status: ['open'],
        limit: 30,
        visibility: 'OnlyMe',
      }),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000, // PERF-3: profile (self) — edit-profile invalidates explicitly
  });

  const hiddenClosed = useProfileClosedPosts({
    profileUserId: userId,
    viewerUserId: userId ?? null,
    listMode: 'owner_only_me',
  });

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: tabBarPad }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.banner}>
          <Ionicons name="eye-off-outline" size={iconSize.md} color={colors.textSecondary} />
          <Text style={styles.bannerText}>{t('profile.hiddenBanner')}</Text>
        </View>
        <Text style={styles.sectionTitle}>{t('profile.hiddenSectionOpen')}</Text>
        <ProfilePostsGrid
          posts={hiddenOpenQuery.data?.posts ?? []}
          isLoading={hiddenOpenQuery.isLoading}
          empty="self_hidden_open"
          postOwner={postOwner}
        />
        <Text style={styles.sectionTitle}>{t('profile.hiddenSectionClosed')}</Text>
        <ProfileClosedPostsGrid
          items={hiddenClosed.items}
          isLoading={hiddenClosed.isLoading}
          empty="self_hidden_closed"
          hasMore={hiddenClosed.hasMore}
          isLoadingMore={hiddenClosed.isLoadingMore}
          onLoadMore={hiddenClosed.loadMore}
          profileUserId={userId!}
          postOwner={postOwner}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1, width: '100%', alignSelf: 'stretch' as const },
  banner: {
    flexDirection: rowDirectionStart,
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,

    borderWidth: isDark ? 1 : 0,
    borderColor: isDark ? colors.border : 'transparent',
    borderRadius: radius.sm,
    borderStartWidth: 3,
    borderStartColor: colors.textSecondary,
  },
  bannerText: {
    flex: 1,
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    lineHeight: 20,
  },
  sectionTitle: {
    ...typography.semiBold,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    marginHorizontal: spacing.base,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
}));
