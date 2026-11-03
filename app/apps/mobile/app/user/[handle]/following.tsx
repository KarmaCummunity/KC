// app/apps/mobile/app/user/[handle]/following.tsx
// Following list — visible to any signed-in viewer. Per D-21 a target's
// `privacy_mode` no longer hides this list; it only governs follow approval.
// FR-PROFILE-010.

import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { spacing, useTheme, Text } from '@kc/ui';
import { FilterSearchBar } from '../../../src/components/filterKit/FilterSearchBar';
import type { User } from '@kc/domain';
import { getUserRepo } from '../../../src/services/userComposition';
import { getListFollowingUseCase } from '../../../src/services/followComposition';
import { useFollowListStyles } from '../../../src/screens/followList.styles';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';
import { FollowUserRow } from '../../../src/components/profile/FollowUserRow';

const userKeyExtractor = (u: User) => u.userId;

export default function FollowingListScreen() {
  const styles = useFollowListStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const [search, setSearch] = React.useState('');

  const userQuery = useQuery({
    queryKey: ['profile-other', handle],
    queryFn: () => getUserRepo().findByHandle(handle!),
    enabled: Boolean(handle),
    staleTime: 60_000, // PERF-3: profile (others) — follow state can flip; keep relatively fresh
  });
  const owner = userQuery.data;

  const followingQuery = useQuery({
    queryKey: ['following', owner?.userId],
    queryFn: () => getListFollowingUseCase().execute({ userId: owner!.userId, limit: 50 }),
    enabled: Boolean(owner?.userId),
    staleTime: 60_000, // PERF-3: profile (others) — follow action invalidates explicitly
  });

  const filtered = useMemo(() => {
    const list = followingQuery.data?.users ?? [];
    if (!search) return list;
    const needle = search.toLowerCase();
    return list.filter((u) => (u.displayName ?? '').toLowerCase().startsWith(needle));
  }, [followingQuery.data?.users, search]);

  const handleOpenUser = useCallback(
    (targetHandle: string) => {
      router.push({ pathname: '/user/[handle]', params: { handle: targetHandle } });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: User }) => (
      <FollowUserRow
        user={item}
        fallbackName={t('profile.fallbackName')}
        cityNotSet={t('profile.cityNotSet')}
        onOpen={handleOpenUser}
        styles={styles}
        textColorSecondary={colors.textSecondary}
      />
    ),
    [colors.textSecondary, handleOpenUser, styles, t],
  );

  if (!owner) {
    return <SafeAreaView style={styles.container} edges={['bottom']}><ActivityIndicator color={colors.primary} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerTitle: t('profile.followingScreen.headerTitle') }} />
      <FilterSearchBar
        style={styles.searchWrap}
        placeholder={t('profile.followingScreen.searchPlaceholder')}
        value={search}
        onChangeText={setSearch}
      />
      {followingQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : (
        <KcFlashList
          data={filtered}
          keyExtractor={userKeyExtractor}
          estimatedItemSize={60}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={styles.empty}>{t('profile.followingScreen.empty')}</Text>}
        />
      )}
    </SafeAreaView>
  );
}
