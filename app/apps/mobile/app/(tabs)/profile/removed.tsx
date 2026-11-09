// My Profile — admin-removed posts, split into prior-open and prior-closed
// lanes mirroring /profile/hidden. Stack header from `profile/_layout.tsx`.
// Mapped to: FR-POST-008 edge-case (owner sees removed_admin posts),
// D-35 (status_before_admin_removal).
// RLS allows this: is_post_visible_to() returns true when owner_id = viewer.
import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { ProfilePostsGrid } from '../../../src/components/profile/ProfilePostsGrid';
import { useShellTabBarScrollInset } from '../../../src/navigation/useShellTabBarVisibility';
import { useAuthStore } from '../../../src/store/authStore';
import { getMyPostsUseCase } from '../../../src/services/postsComposition';
import { useMyProfilePostOwner } from '../../../src/hooks/useProfilePostOwner';
import { rowDirectionStart } from '../../../src/lib/rtlLayout';
import { rtlTextAlignStart } from '../../../src/lib/rtlTextAlignStart';
import { OWNER_MODERATED_POST_STATUSES, removedPostLane } from '../../../src/lib/moderation/postModeration';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function MyProfileRemovedScreen() {
  const styles = useStyles();
  const tabBarPad = useShellTabBarScrollInset();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.session?.userId);
  const postOwner = useMyProfilePostOwner();

  const removedPostsQuery = useQuery({
    queryKey: ['my-removed-posts', userId],
    queryFn: () =>
      getMyPostsUseCase().execute({
        userId: userId!,
        status: [...OWNER_MODERATED_POST_STATUSES],
        limit: 30,
      }),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000, // PERF-3: profile (self) — admin removal invalidates explicitly
  });

  const { openLane, closedLane } = useMemo(() => {
    const all = removedPostsQuery.data?.posts ?? [];
    // Lanes by the status before removal; legacy rows (null) default to open (D-35).
    return {
      openLane: all.filter((p) => removedPostLane(p.statusBeforeAdminRemoval) === 'open'),
      closedLane: all.filter((p) => removedPostLane(p.statusBeforeAdminRemoval) === 'closed'),
    };
  }, [removedPostsQuery.data?.posts]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: tabBarPad }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.banner}>
          <Ionicons name="shield-outline" size={iconSize.md} color={colors.textSecondary} />
          <Text style={styles.bannerText}>{t('profile.removedBanner')}</Text>
        </View>
        <Text style={styles.sectionTitle}>{t('profile.removedSectionOpen')}</Text>
        <ProfilePostsGrid
          posts={openLane}
          isLoading={removedPostsQuery.isLoading}
          empty="self_removed_open"
          postOwner={postOwner}
        />
        <Text style={styles.sectionTitle}>{t('profile.removedSectionClosed')}</Text>
        <ProfilePostsGrid
          posts={closedLane}
          isLoading={removedPostsQuery.isLoading}
          empty="self_removed_closed"
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
    borderStartColor: colors.error,
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
