// FR-KARMA-007 — karma history: every point change, newest first.
import React from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { KcFlashList } from '../src/components/lists/KcFlashList';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale/he';
import { iconSize, makeUseStyles, radius, shadow, spacing, typography, useTheme, Text } from '@kc/ui';
import { useAuthStore } from '../src/store/authStore';
import { getUserRepo } from '../src/services/userComposition';
import { karmaReasonKey, useKarmaHistory, type KarmaHistoryRow } from '../src/hooks/useKarmaHistory';
import { karmaEventIcon } from '../src/components/profile/karmaHistoryIcon';
import { rowDirectionStart } from '../src/lib/rtlLayout';
import { MirroredIcon, useDirectionalBackIcon } from '../src/components/ui/MirroredIcon';
import { rtlTextAlignStart } from '../src/lib/rtlTextAlignStart';
import { useShellTabBarScrollInset } from '../src/navigation/useShellTabBarVisibility';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export default function KarmaHistoryScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const backIcon = useDirectionalBackIcon();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.session?.userId);
  const userQuery = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => getUserRepo().findById(userId!),
    enabled: Boolean(userId),
    // Always re-read the owner RPC total on open (persisted cache may be stale).
    refetchOnMount: 'always',
  });
  const history = useKarmaHistory(userId);
  const bottomPad = useShellTabBarScrollInset();

  const renderItem = ({ item }: { item: KarmaHistoryRow }) => {
    const positive = item.delta >= 0;
    const tone = positive ? colors.success : colors.error;
    return (
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: `${tone}1A` }]}>
          <Ionicons name={karmaEventIcon(item.eventType) as IconName} size={iconSize.lg} color={tone} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.reason} numberOfLines={2}>{t(`karma.reason.${karmaReasonKey(item.eventType)}`)}</Text>
          <Text style={styles.date}>{format(new Date(item.createdAt), 'd MMM yyyy, HH:mm', { locale: dateFnsHe })}</Text>
        </View>
        <Text style={[styles.delta, { color: tone }]}>{positive ? `+${item.delta}` : `${item.delta}`}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('karma.close')}>
          <MirroredIcon name={backIcon} size={iconSize['2xl']} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('karma.historyTitle')}</Text>
        <View style={styles.headerSpacer} />
      </View>
      <KcFlashList
        data={history.data ?? []}
        keyExtractor={(r) => String(r.id)}
        renderItem={renderItem}
        estimatedItemSize={72}
        contentContainerStyle={{ ...styles.list, paddingBottom: bottomPad }}
        ListHeaderComponent={
          <View style={styles.hero}>
            <Ionicons
              name="sparkles"
              size={28 /* brand-guard-allow: hero illustration glyph */}
              color={colors.primary}
            />
            <Text style={styles.total}>{userQuery.data?.karmaPoints ?? 0}</Text>
            <Text style={styles.totalLabel}>{t('karma.badgeLabel')}</Text>
            <Text style={styles.heroHint}>{t('karma.howToEarnIntro')}</Text>
          </View>
        }
        ListEmptyComponent={
          history.isLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} />
            : <Text style={styles.empty}>{history.isError ? t('karma.historyError') : t('karma.historyEmpty')}</Text>
        }
      />
    </SafeAreaView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { ...typography.h3, flex: 1, textAlign: 'center' as const, color: colors.textPrimary },
  headerSpacer: { width: 24 },
  list: { padding: spacing.base, paddingBottom: spacing['3xl'] },
  hero: {
    alignItems: 'center' as const,
    gap: spacing.xs,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySurface,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  total: { ...typography.h1, color: colors.primary },
  totalLabel: { ...typography.body, color: colors.textPrimary, ...typography.semiBold },
  heroHint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' as const, marginTop: spacing.xs },
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  iconWrap: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center' as const, justifyContent: 'center' as const },
  rowBody: { flex: 1, minWidth: 0, gap: spacing.xs },
  reason: { ...typography.body, ...typography.semiBold, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  date: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  delta: { ...typography.h4, ...typography.bold, minWidth: 44, textAlign: 'center' as const },
  loader: { marginTop: spacing.xl },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center' as const, marginTop: spacing.xl },
}));
