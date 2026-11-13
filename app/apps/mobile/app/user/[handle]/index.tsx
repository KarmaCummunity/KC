// app/apps/mobile/app/user/[handle]/index.tsx
// Other-user profile — uniform render for Public and Private profiles.
// Per D-21 the Private mode no longer hides posts/counters/lists; the only
// user-facing differences are the lock icon (FR-PROFILE-012) and the
// "Send Follow Request" CTA (FR-FOLLOW-006).
// Mapped to SRS: FR-PROFILE-002, 003, 004; FR-FOLLOW-001..006, 011, 012.

import React from 'react';
import { ActivityIndicator, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useProfileClosedPosts } from '../../../src/hooks/useProfileClosedPosts';
import { useProfileTabCounts } from '../../../src/hooks/useProfileTabCounts';
import { iconSize, spacing, useTheme, Text } from '@kc/ui';
import { ProfileHeader } from '../../../src/components/profile/ProfileHeader';
import { ProfileStatsRow } from '../../../src/components/profile/ProfileStatsRow';
import { ProfileTabs, type ProfilePostsTab } from '../../../src/components/profile/ProfileTabs';
import { ProfilePostsGrid } from '../../../src/components/profile/ProfilePostsGrid';
import { ProfileClosedPostsGrid } from '../../../src/components/profile/ProfileClosedPostsGrid';
import { FollowButton } from '../../../src/components/profile/FollowButton';
import { useAuthStore } from '../../../src/store/authStore';
import { getUserRepo } from '../../../src/services/userComposition';
import { getMyPostsUseCase } from '../../../src/services/postsComposition';
import { getGetFollowStateUseCase } from '../../../src/services/followComposition';
import {
  useOptimisticFollowAction,
  type FollowActionError,
} from '../../../src/hooks/useOptimisticFollowAction';
import { useOtherProfileActions } from '../../../src/hooks/useOtherProfileActions';
import { hasPermission, type AdminRole, type User } from '@kc/domain';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { useAdminPerson } from '../../../src/hooks/useAdminPerson';
import { NotifyModal } from '../../../src/components/NotifyModal';
import { ProfileOverflowMenu } from '../../../src/components/profile/ProfileOverflowMenu';
import { formatUserLocationLine } from '../../../src/lib/formatUserLocationLine';
import { profilePostOwnerFromUser } from '../../../src/lib/profilePostOwnerContext';
import { getRestoredProfileTab, persistProfileTab } from '../../../src/lib/profileTabSession';
import {
  useOtherProfileScreenStyles,
} from '../../../src/components/profile/otherProfileScreen.styles';
import { nativeStackHeaderRightIconOnly } from '../../../src/navigation/nativeHeaderIconOnly';
export default function OtherProfileScreen() {
  const styles = useOtherProfileScreenStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const me = useAuthStore((s) => s.session?.userId);
  const [activeTab, setActiveTab] = React.useState<ProfilePostsTab>(() =>
    getRestoredProfileTab({ otherHandle: handle ?? '' }),
  );
  // ✅ RULES OF HOOKS: must be declared here, before any early return.
  const [error, setError] = React.useState<FollowActionError | null>(null);

  const userQuery = useQuery({
    queryKey: ['profile-other', handle],
    queryFn: async () => {
      // TD-73: notification triggers historically emitted the user_id as the
      // `handle` param. Triggers were corrected in migration 0134, but any
      // notification already enqueued before that runs through this route
      // with a UUID — `findByHandle` (queries `share_handle`) would silently
      // miss. Detect UUID-shaped params and route to `findById` so old taps
      // also resolve.
      const repo = getUserRepo();
      const handleByName = await repo.findByHandle(handle!);
      if (handleByName) return handleByName;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(handle!)) {
        return repo.findById(handle!);
      }
      return null;
    },
    enabled: Boolean(handle),
    staleTime: 60_000, // PERF-3: profile (others) — follow state can flip; keep relatively fresh
  });
  const u = userQuery.data ?? null;
  const postOwner = React.useMemo(
    () => (u ? profilePostOwnerFromUser(u, t('profile.fallbackName')) : undefined),
    [u, t],
  );

  const stateQuery = useQuery({
    queryKey: ['follow-state', me, u?.userId],
    queryFn: () => getGetFollowStateUseCase().execute({ viewerId: me!, targetUserId: u!.userId }),
    enabled: Boolean(me && u?.userId && me !== u.userId),
    staleTime: 30_000, // PERF-3: follow state — short; follow actions flip this
  });
  const followInfo = stateQuery.data;

  const isMe = me === u?.userId;

  // ✅ RULES OF HOOKS: useOptimisticFollowAction must be called here, before any early return.
  // When `u` is null (still loading), we pass a safe fallback so the hook is always called.
  const dispatchFollowAction = useOptimisticFollowAction({
    viewerId: me,
    target: u ?? ({ userId: '', shareHandle: '', privacyMode: 'Public' } as User),
    handle: handle ?? '',
    onError: setError,
  });

  // ✅ RULES OF HOOKS: useOtherProfileActions must be called before any early return.
  // The hook accepts `target: User | null` so passing `u` (possibly null) is safe.
  const { onFollowPress, startChat } = useOtherProfileActions({ me, target: u, dispatchFollowAction });

  // FR-ADMIN-022 — if the viewer can see the admin roster and this user holds
  // an admin grant, expose a cross-link to their admin-detail card.
  const { roles: viewerRoles } = useAdminRoles();
  const canViewAdmins = hasPermission(viewerRoles as readonly AdminRole[], 'admins.view');
  const { person: adminPerson } = useAdminPerson(u?.userId, canViewAdmins);
  const showAdminLink = canViewAdmins && adminPerson !== null && adminPerson.grants.length > 0;

  // /user/[my-handle] redirects to the My Profile tab.
  React.useEffect(() => { if (isMe) router.replace('/(tabs)/profile'); }, [isMe, router]);

  const postsQuery = useQuery({
    queryKey: ['profile-other-posts', u?.userId],
    queryFn: () => getMyPostsUseCase().execute({
      userId: u!.userId,
      status: ['open'],
      limit: 30,
    }),
    enabled: Boolean(u?.userId) && activeTab === 'open',
    staleTime: 60_000, // PERF-3: profile (others) — follow state can flip; keep relatively fresh
  });

  const tabCounts = useProfileTabCounts({
    profileUserId: u?.userId,
    viewerUserId: me ?? null,
    enabled: Boolean(u?.userId),
  });

  const closed = useProfileClosedPosts({
    profileUserId: u?.userId,
    viewerUserId: me ?? null,
    enabled: activeTab === 'closed',
  });

  if (!handle || userQuery.isLoading)
    return <SafeAreaView style={styles.container} edges={['bottom']}><ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} /></SafeAreaView>;

  if (!u) return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerTitle: t('profile.otherScreen.headerTitle') }} />
      <View style={styles.notFound}>
        <Text style={styles.notFoundText}>{t('profile.otherScreen.userNotFound')}</Text>
      </View>
    </SafeAreaView>
  );

  // CTA paints immediately during stateQuery flight. On error we keep the button
  // visible but busy/disabled so a transient failure can't double-tap-fire.
  const followState = followInfo?.state ?? 'not_following_public';
  const showFollowButton = Boolean(me) && !isMe;
  const followBusy = stateQuery.isLoading || stateQuery.isError;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerTitle: '',
          ...(!isMe
            ? nativeStackHeaderRightIconOnly(() => (
                <ProfileOverflowMenu
                  targetUserId={u.userId}
                  profileShare={{ shareHandle: u.shareHandle, displayName: u.displayName }}
                />
              ))
            : { headerRight: undefined }),
        }}
      />
      <ScrollView>
        <View style={styles.card}>
          <ProfileHeader
            displayName={u.displayName ?? t('profile.fallbackName')}
            handle={u.shareHandle}
            locationLine={formatUserLocationLine(u)}
            avatarUrl={u.avatarUrl}
            biography={u.biography}
            privacyMode={u.privacyMode}
            verificationLevel={u.verificationLevel}
          />

          <ProfileStatsRow
            followersCount={u.followersCount}
            followingCount={u.followingCount}
            postsCount={tabCounts.totalCount ?? 0}
            enabled
            onPressFollowers={() => router.push({ pathname: '/user/[handle]/followers', params: { handle } })}
            onPressFollowing={() => router.push({ pathname: '/user/[handle]/following', params: { handle } })}
          />

          {showAdminLink ? (
            <TouchableOpacity
              style={styles.adminLink}
              onPress={() => router.push({ pathname: '/(admin)/admins/[userId]', params: { userId: u.userId } })}
            >
              <Ionicons name="shield-checkmark-outline" size={iconSize.sm} color={colors.primary} />
              <Text style={styles.adminLinkText}>{t('admin.admins.profileLink')}</Text>
            </TouchableOpacity>
          ) : null}

          {!isMe ? (
            <View style={styles.actionRow}>
              {showFollowButton ? (
                <View style={styles.btnFlex}>
                  <FollowButton
                    state={followState}
                    cooldownUntil={followInfo?.cooldownUntil}
                    onPress={() => onFollowPress(followInfo?.state)}
                    busy={followBusy}
                    interactionDisabled={followInfo?.followInteractionDisabled}
                  />
                </View>
              ) : null}
              <TouchableOpacity style={styles.msgBtn} onPress={startChat}>
                <Ionicons name="chatbubble-outline" size={iconSize.md} color={colors.primary} />
                <Text style={styles.msgBtnText}>{t('profile.otherScreen.sendMessage')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <ProfileTabs
          active={activeTab}
          onChange={(tab) => {
            if (handle) persistProfileTab({ otherHandle: handle }, tab);
            setActiveTab(tab);
          }}
          openCount={tabCounts.openCount}
          closedCount={tabCounts.closedCount}
        />
        {activeTab === 'open' ? (
          <ProfilePostsGrid
            posts={postsQuery.data?.posts ?? []}
            isLoading={postsQuery.isLoading}
            empty="other_open"
            postOwner={postOwner}
          />
        ) : (
          <ProfileClosedPostsGrid
            items={closed.items}
            isLoading={closed.isLoading}
            empty="other_closed"
            hasMore={closed.hasMore}
            isLoadingMore={closed.isLoadingMore}
            onLoadMore={closed.loadMore}
            profileUserId={u.userId}
            postOwner={postOwner}
          />
        )}
      </ScrollView>
      <NotifyModal
        visible={error !== null}
        title={error?.title ?? ''}
        message={error?.message ?? ''}
        onDismiss={() => setError(null)}
      />
    </SafeAreaView>
  );
}
