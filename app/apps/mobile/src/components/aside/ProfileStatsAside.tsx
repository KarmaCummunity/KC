// Own-profile aside — personal stats summary (FR-RESP-003).
// Reuses the FR-STATS-001 self queries (shared keys with the stats screen).
import { TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { useAuthStore } from '../../store/authStore';
import { getUserRepo } from '../../services/userComposition';
import { useProfileTabCounts } from '../../hooks/useProfileTabCounts';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { AsideCard } from './AsideCard';
import { AsideStatList, type AsideStatRow } from './AsideStatList';

export function ProfileStatsAside() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const userId = useAuthStore((s) => s.session?.userId);

  const userQuery = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => getUserRepo().findById(userId!),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000, // PERF-3: profile (self) — shared key with the stats screen
  });
  const { openCount, closedCount } = useProfileTabCounts({
    profileUserId: userId,
    viewerUserId: userId ?? null,
  });

  const u = userQuery.data;
  const rows: AsideStatRow[] = [
    { key: 'karma', label: t('aside.profileKarma'), value: u?.karmaPoints },
    { key: 'given', label: t('stats.given'), value: u?.itemsGivenCount },
    { key: 'received', label: t('stats.received'), value: u?.itemsReceivedCount },
    { key: 'open', label: t('aside.profileOpenPosts'), value: openCount },
    { key: 'closed', label: t('aside.profileClosedPosts'), value: closedCount },
  ];

  return (
    <AsideCard title={t('aside.profileStatsTitle')}>
      <AsideStatList rows={rows} testIDPrefix="aside-profile" />
      <TouchableOpacity
        accessibilityRole="button"
        testID="aside-profile-all-stats"
        onPress={() => router.push('/stats')}
      >
        <Text style={styles.allLink}>{t('aside.profileAllStats')}</Text>
      </TouchableOpacity>
    </AsideCard>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  allLink: {
    ...typography.bodySmall,
    color: colors.primary,
    marginTop: spacing.xs,
    textAlign: rtlTextAlignStart,
  },
}));
