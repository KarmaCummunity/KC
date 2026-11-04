// app/apps/mobile/app/user/[handle]/followers.tsx
// Followers list — visible to any signed-in viewer. Per D-21 a target's
// `privacy_mode` no longer hides this list; it only governs follow approval.
// FR-PROFILE-009 / FR-PROFILE-010. Each row carries dynamic Follow + ⋮ "Remove follower" if self.

import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { spacing, useTheme, Text } from '@kc/ui';
import { FilterSearchBar } from '../../../src/components/filterKit/FilterSearchBar';
import type { User } from '@kc/domain';
import { ConfirmActionModal } from '../../../src/components/post/ConfirmActionModal';
import { useAuthStore } from '../../../src/store/authStore';
import { getUserRepo } from '../../../src/services/userComposition';
import {
  getListFollowersUseCase,
  getRemoveFollowerUseCase,
} from '../../../src/services/followComposition';
import { useFollowListStyles } from '../../../src/screens/followList.styles';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';
import { FollowUserRow } from '../../../src/components/profile/FollowUserRow';

const userKeyExtractor = (u: User) => u.userId;

export default function FollowersListScreen() {
  const styles = useFollowListStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const me = useAuthStore((s) => s.session?.userId);
  const qc = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [pendingRemove, setPendingRemove] = React.useState<User | null>(null);
  const [busyRemove, setBusyRemove] = React.useState(false);

  const userQuery = useQuery({
    queryKey: ['profile-other', handle],
    queryFn: () => getUserRepo().findByHandle(handle!),
    enabled: Boolean(handle),
    staleTime: 60_000, // PERF-3: profile (others) — follow state can flip; keep relatively fresh
  });
  const owner = userQuery.data;
  const isMe = me === owner?.userId;

  const followersQuery = useQuery({
    queryKey: ['followers', owner?.userId],
    queryFn: () => getListFollowersUseCase().execute({ userId: owner!.userId, limit: 50 }),
    enabled: Boolean(owner?.userId),
    staleTime: 60_000, // PERF-3: profile (others) — remove-follower action invalidates explicitly
  });

  const filtered = useMemo(() => {
    const list = followersQuery.data?.users ?? [];
    if (!search) return list;
    const needle = search.toLowerCase();
    return list.filter((u) => (u.displayName ?? '').toLowerCase().startsWith(needle));
  }, [followersQuery.data?.users, search]);

  const handleOpenUser = useCallback(
    (targetHandle: string) => {
      router.push({ pathname: '/user/[handle]', params: { handle: targetHandle } });
    },
    [router],
  );

  const handleRemoveUser = useCallback((u: User) => {
    setPendingRemove(u);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: User }) => (
      <FollowUserRow
        user={item}
        fallbackName={t('profile.fallbackName')}
        cityNotSet={t('profile.cityNotSet')}
        isMe={isMe}
        onOpen={handleOpenUser}
        onRemove={isMe ? handleRemoveUser : undefined}
        styles={styles}
        textColorSecondary={colors.textSecondary}
      />
    ),
    [colors.textSecondary, handleOpenUser, handleRemoveUser, isMe, styles, t],
  );

  if (!owner) {
    return <SafeAreaView style={styles.container} edges={['bottom']}><ActivityIndicator color={colors.primary} /></SafeAreaView>;
  }

  const confirmRemove = async () => {
    if (!me || !isMe || !pendingRemove) return;
    setBusyRemove(true);
    try {
      await getRemoveFollowerUseCase().execute({
        sessionUserId: me,
        ownerId: me,
        followerId: pendingRemove.userId,
      });
      qc.invalidateQueries({ queryKey: ['followers', me] });
      qc.invalidateQueries({ queryKey: ['user-profile', me] });
      setPendingRemove(null);
    } finally {
      setBusyRemove(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerTitle: t('profile.followersScreen.headerTitle') }} />
      <FilterSearchBar
        style={styles.searchWrap}
        placeholder={t('profile.followersScreen.searchPlaceholder')}
        value={search}
        onChangeText={setSearch}
      />
      {followersQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : (
        <KcFlashList
          data={filtered}
          keyExtractor={userKeyExtractor}
          estimatedItemSize={60}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={styles.empty}>{t('profile.followersScreen.empty')}</Text>}
        />
      )}
      <ConfirmActionModal
        visible={pendingRemove !== null}
        title={t('profile.followersScreen.removeFollowerTitle')}
        message={pendingRemove
          ? t('profile.followersScreen.removeFollowerMessage', { name: pendingRemove.displayName })
          : ''}
        confirmLabel={t('profile.followersScreen.removeFollowerConfirm')}
        destructive
        isBusy={busyRemove}
        onCancel={() => (busyRemove ? null : setPendingRemove(null))}
        onConfirm={confirmRemove}
      />
    </SafeAreaView>
  );
}
