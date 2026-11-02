// app/apps/mobile/app/user/[handle]/followers.tsx
// Followers list — visible to any signed-in viewer. Per D-21 a target's
// `privacy_mode` no longer hides this list; it only governs follow approval.
// FR-PROFILE-009 / FR-PROFILE-010. Each row carries dynamic Follow + ⋮ "Remove follower" if self.

import React from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { iconSize, spacing, useTheme, Text } from '@kc/ui';
import { FilterSearchBar } from '../../../src/components/filterKit/FilterSearchBar';
import type { User } from '@kc/domain';
import { AvatarInitials } from '../../../src/components/AvatarInitials';
import { ConfirmActionModal } from '../../../src/components/post/ConfirmActionModal';
import { useAuthStore } from '../../../src/store/authStore';
import { getUserRepo } from '../../../src/services/userComposition';
import {
  getListFollowersUseCase,
  getRemoveFollowerUseCase,
} from '../../../src/services/followComposition';
import { useFollowListStyles } from '../../../src/screens/followList.styles';

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

  if (!owner) {
    return <SafeAreaView style={styles.container} edges={['bottom']}><ActivityIndicator color={colors.primary} /></SafeAreaView>;
  }

  const filtered = (followersQuery.data?.users ?? []).filter((u) =>
    !search || (u.displayName ?? '').toLowerCase().startsWith(search.toLowerCase()),
  );

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
      ) : filtered.length === 0 ? (
        <Text style={styles.empty}>{t('profile.followersScreen.empty')}</Text>
      ) : (
        filtered.map((u) => (
          <TouchableOpacity
            key={u.userId}
            style={styles.row}
            onPress={() => router.push({ pathname: '/user/[handle]', params: { handle: u.shareHandle } })}
          >
            <AvatarInitials name={u.displayName ?? t('profile.fallbackName')} avatarUrl={u.avatarUrl} size={44} />
            <View style={styles.rowText}>
              <Text style={styles.name}>{u.displayName ?? t('profile.fallbackName')}</Text>
              <Text style={styles.city}>{u.cityName ?? t('profile.cityNotSet')}</Text>
            </View>
            {isMe ? (
              <TouchableOpacity onPress={() => setPendingRemove(u)} style={styles.menuBtn}>
                <Ionicons name="ellipsis-horizontal" size={iconSize.md} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </TouchableOpacity>
        ))
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
