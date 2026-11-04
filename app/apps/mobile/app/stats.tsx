// Personal & community statistics — FR-STATS-001..004.
import React, { useCallback, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MirroredIcon, useDirectionalBackIcon } from '../src/components/ui/MirroredIcon';
import { useQuery } from '@tanstack/react-query';
import { makeUseStyles, iconSize, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import type { PersonalActivityItem } from '@kc/domain';
import { useAuthStore } from '../src/store/authStore';
import { getUserRepo } from '../src/services/userComposition';
import {
  getCommunityStatsSnapshotUseCase,
  getListMyActivityTimelineUseCase,
} from '../src/services/postsComposition';
import { PersonalStatsStrip } from '../src/components/stats/PersonalStatsStrip';
import { KarmaBadge } from '../src/components/profile/KarmaBadge';
import { useMeRealtime } from '../src/hooks/useMeRealtime';
import { CommunityStatsPanel } from '../src/components/stats/CommunityStatsPanel';
import { ActivityTimelineList } from '../src/components/stats/ActivityTimelineList';
import { MyWorldGivingsPanel } from '../src/components/stats/MyWorldGivingsPanel';
import { OrgTransparencySection } from '../src/components/finance/OrgTransparencySection';
import { rowDirectionStart } from '../src/lib/rtlLayout';
import { rtlTextAlignStart } from '../src/lib/rtlTextAlignStart';




export default function StatsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const backIcon = useDirectionalBackIcon();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.session?.userId);
  useMeRealtime();

  const userQuery = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => getUserRepo().findById(userId!),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000, // PERF-3: profile (self) — stats row
  });

  const communityQuery = useQuery({
    queryKey: ['community-stats'],
    queryFn: () => getCommunityStatsSnapshotUseCase().execute(),
    staleTime: 5 * 60_000, // PERF-3: stats — Realtime subscription in useCommunityStatsAbout keeps cache warm
  });

  const activityQuery = useQuery({
    queryKey: ['my-activity-timeline', userId],
    queryFn: () => getListMyActivityTimelineUseCase().execute(30),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000, // PERF-3: stats — staleTime avoids refetch within 5 min
  });

  const resolveActivityLabel = useCallback(
    (item: PersonalActivityItem) =>
      t(`stats.activityKind.${item.kind}`, {
        title: item.postTitle,
        owner: item.actorDisplayName ?? t('stats.activitySomeone'),
      }),
    [t],
  );

  const counterLabels = useMemo(
    () => ({
      given: t('stats.given'),
      received: t('stats.received'),
      active: t('stats.activePosts'),
    }),
    [t],
  );

  const u = userQuery.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <MirroredIcon name={backIcon} size={iconSize['2xl']} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerTitles}>
          <Text style={styles.title}>{t('stats.title')}</Text>
          <Text style={styles.subtitle}>{t('stats.subtitle')}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <CommunityStatsPanel
          users={communityQuery.data?.registeredUsers ?? 0}
          posts={communityQuery.data?.activePublicPosts ?? 0}
          delivered={communityQuery.data?.itemsDeliveredTotal ?? 0}
          loading={communityQuery.isLoading}
          error={communityQuery.isError}
          labels={{
            title: t('stats.communityTitle'),
            users: t('stats.communityUsers'),
            posts: t('stats.communityPosts'),
            delivered: t('stats.communityDelivered'),
            hint: t('stats.communityHint'),
            retry: t('general.retry'),
          }}
          onRetry={() => void communityQuery.refetch()}
        />

        <OrgTransparencySection />

        {u ? (
          <View style={styles.karmaCard}>
            <KarmaBadge points={u.karmaPoints} />
          </View>
        ) : null}

        <View style={styles.hero}>
          <PersonalStatsStrip
            given={u?.itemsGivenCount ?? 0}
            received={u?.itemsReceivedCount ?? 0}
            active={u?.activePostsCountInternal ?? 0}
            loading={userQuery.isLoading}
            labels={counterLabels}
          />
        </View>
        <MyWorldGivingsPanel userId={userId} />
        

<Text style={styles.sectionTitle}>{t('stats.recentActivity')}</Text>
        <ActivityTimelineList
          items={activityQuery.data ?? []}
          loading={activityQuery.isLoading}
          error={activityQuery.isError}
          emptyLabel={t('stats.activityEmpty')}
          retryLabel={t('general.retry')}
          resolveLabel={resolveActivityLabel}
          onRetry={() => void activityQuery.refetch()}
          onPressPost={(id) => router.push({ pathname: '/post/[id]', params: { id } })}
        />

      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,

    borderWidth: isDark ? 1 : 0,
    borderColor: isDark ? colors.border : 'transparent',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitles: { flex: 1, alignItems: 'center', marginHorizontal: spacing.sm },
  headerSpacer: { width: 24 },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart, marginTop: spacing.xs },
  scroll: {
    padding: spacing.base,
    paddingBottom: spacing['3xl'],
    gap: spacing.lg,
  },
  hero: {
    backgroundColor: colors.primarySurface,
    borderRadius: radius.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  sectionTitle: { ...typography.h4, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  karmaCard: { alignItems: 'flex-end' as const },
}));
