// app/apps/mobile/app/user/[handle]/following.tsx
// Following list — visible to any signed-in viewer. Per D-21 a target's
// `privacy_mode` no longer hides this list; it only governs follow approval.
// FR-PROFILE-010.

import React from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { spacing, useTheme, Text } from '@kc/ui';
import { FilterSearchBar } from '../../../src/components/filterKit/FilterSearchBar';
import { AvatarInitials } from '../../../src/components/AvatarInitials';
import { getUserRepo } from '../../../src/services/userComposition';
import { getListFollowingUseCase } from '../../../src/services/followComposition';
import { useFollowListStyles } from '../../../src/screens/followList.styles';

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

  if (!owner) {
    return <SafeAreaView style={styles.container} edges={['bottom']}><ActivityIndicator color={colors.primary} /></SafeAreaView>;
  }

  const filtered = (followingQuery.data?.users ?? []).filter((u) =>
    !search || (u.displayName ?? '').toLowerCase().startsWith(search.toLowerCase()),
  );

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
      ) : filtered.length === 0 ? (
        <Text style={styles.empty}>{t('profile.followingScreen.empty')}</Text>
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
          </TouchableOpacity>
        ))
      )}
    </SafeAreaView>
  );
}
