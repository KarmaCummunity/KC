// app/apps/mobile/app/(admin)/index.tsx
// FR-ADMIN-011 — admin dashboard. Welcome hero with role badges plus a
// responsive grid of stat / quick-link cards, RBAC-filtered per session.
// Users/posts KPIs show community-wide counts (FR-STATS-004 / community_stats).
import type { ComponentProps, ReactElement } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { AdminRole } from '@kc/domain';
import { hasPermission } from '@kc/domain';
import { iconSize, makeUseStyles, radius, shadow, spacing, Text, typography, useTheme } from '@kc/ui';
import { rowDirectionStart, textAlignStart } from '../../src/lib/rtlLayout';
import { useAdminRoles } from '../../src/hooks/useAdminRoles';
import { useAdminsList } from '../../src/hooks/useAdminsList';
import { useAdminTasksList } from '../../src/hooks/useAdminTasks';
import { useReportsInbox } from '../../src/hooks/useReportsInbox';
import { getCommunityStatsSnapshotUseCase } from '../../src/services/postsComposition';
import { useLocaleBundle } from '../../src/i18n/useLocaleBundle';
import { useAdminPortalChrome } from '../../src/components/admin/AdminPortalChrome';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface Card {
  key: string;
  label: string;
  value: string;
  icon: IconName;
  accent: string;
  accentBg: string;
  href: string;
}

export default function AdminDashboard(): ReactElement {
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const L = useLocaleBundle();
  const ROLE_LABELS: Readonly<Record<AdminRole, string>> = L.admin.roles;
  const t = L.admin.dashboard;
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();

  const inbox = useReportsInbox({});
  const firstPage = inbox.data?.pages[0];
  const reportsLabel = firstPage
    ? `${firstPage.rows.length}${firstPage.nextCursor ? '+' : ''}`
    : t.noCount;

  const tasksQuery = useAdminTasksList({});
  const openTasksLabel = tasksQuery.isLoading
    ? t.noCount
    : String(
        tasksQuery.tasks.filter(
          (task) => task.status === 'open' || task.status === 'in_progress',
        ).length,
      );

  const canViewAdmins = hasPermission(roles, 'admins.view');
  const canSearchUsers = hasPermission(roles, 'users.search');
  const canSearchPosts = hasPermission(roles, 'posts.search');
  const canViewSurveys = hasPermission(roles, 'surveys.view');
  const canViewAudit = hasPermission(roles, 'audit.view_own');

  const adminsQuery = useAdminsList(false, !rolesLoading && canViewAdmins);
  const adminsLabel = !canViewAdmins || adminsQuery.isLoading
    ? t.noCount
    : String(adminsQuery.grants.length);

  // Community-wide counts for the users + posts KPIs (FR-STATS-004). Only
  // fetched when at least one count renders — avoids network for moderators
  // without users.search / posts.search.
  const showCommunityCounts = canSearchUsers || canSearchPosts;
  const communityStatsQuery = useQuery({
    queryKey: ['admin.dashboard.community_stats'],
    queryFn: () => getCommunityStatsSnapshotUseCase().execute(),
    enabled: showCommunityCounts,
    staleTime: 1000 * 60,
  });
  const usersLabel = communityStatsQuery.data
    ? String(communityStatsQuery.data.registeredUsers)
    : t.noCount;
  const postsLabel = communityStatsQuery.data
    ? String(communityStatsQuery.data.activePublicPosts)
    : t.noCount;

  const cards: Card[] = [
    { key: 'reports', label: t.openReportsKpi, value: reportsLabel, icon: 'flag-outline', accent: colors.error, accentBg: colors.errorLight, href: '/(admin)/reports' },
    { key: 'tasks', label: t.openTasksKpi, value: openTasksLabel, icon: 'checkbox-outline', accent: colors.info, accentBg: colors.infoLight, href: '/(admin)/tasks' },
  ];
  if (canViewAdmins) cards.push({ key: 'admins', label: t.adminsKpi, value: adminsLabel, icon: 'shield-checkmark-outline', accent: colors.secondary, accentBg: colors.secondaryLight, href: '/(admin)/admins' });
  if (canSearchUsers) cards.push({ key: 'users', label: t.usersKpi, value: usersLabel, icon: 'people-outline', accent: colors.success, accentBg: colors.successLight, href: '/(admin)/users' });
  if (canSearchPosts) cards.push({ key: 'posts', label: t.postsKpi, value: postsLabel, icon: 'document-text-outline', accent: colors.primary, accentBg: colors.primaryLight, href: '/(admin)/posts' });
  if (canViewSurveys) cards.push({ key: 'surveys', label: t.surveysKpi, value: t.auditOpenLabel, icon: 'bar-chart-outline', accent: colors.secondary, accentBg: colors.secondaryLight, href: '/(admin)/surveys' });
  if (canViewAudit) cards.push({ key: 'audit', label: t.auditKpi, value: t.auditOpenLabel, icon: 'time-outline', accent: colors.warning, accentBg: colors.warningLight, href: '/(admin)/audit' });

  const goTo = (path: string): void => router.push(path as never);

  useAdminPortalChrome({ title: L.admin.portalTitle });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.root}>
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>{L.admin.portalTitle}</Text>
        <Text style={styles.heroTitle}>{t.welcome}</Text>
        <View style={styles.badges}>
          {roles.map((role) => (
            <View key={role} style={styles.badge}>
              <Text style={styles.badgeText}>{ROLE_LABELS[role] ?? role}</Text>
            </View>
          ))}
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t.quickLinksTitle}</Text>
      <View style={styles.grid}>
        {cards.map((c) => (
          <Pressable
            key={c.key}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => goTo(c.href)}
            accessibilityRole="button"
            accessibilityLabel={c.label}
          >
            <View style={styles.cardTop}>
              <View style={[styles.iconWrap, { backgroundColor: c.accentBg }]}>
                <Ionicons name={c.icon} size={iconSize.lg} color={c.accent} />
              </View>
              <Text style={styles.cardValue}>{c.value}</Text>
            </View>
            <Text style={styles.cardLabel}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  root: { padding: spacing.base, gap: spacing.base, paddingBottom: spacing['4xl'] + spacing['2xl'], width: '100%', maxWidth: 900, alignSelf: 'center' },

  hero: {
    backgroundColor: colors.primarySurface,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  heroEyebrow: { fontSize: typography.bodySmall.fontSize, ...typography.bold, color: colors.primary, letterSpacing: 0.5, textAlign: textAlignStart() },
  heroTitle: { fontSize: typography.h2.fontSize, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  badges: { flexDirection: rowDirectionStart, flexWrap: 'wrap', gap: spacing.xs },
  badge: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  badgeText: { fontSize: typography.bodySmall.fontSize, ...typography.bold, color: colors.primaryDark },

  sectionTitle: { fontSize: typography.body.fontSize, ...typography.bold, color: colors.textSecondary, textAlign: textAlignStart(), marginTop: spacing.xs },
  grid: { flexDirection: rowDirectionStart, flexWrap: 'wrap', gap: spacing.md },
  card: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 150,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.base,
    gap: spacing.md,
    ...shadow.card,
  },
  cardPressed: { opacity: 0.7 },
  cardTop: { flexDirection: rowDirectionStart, alignItems: 'center', justifyContent: 'space-between' },
  iconWrap: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cardValue: { fontSize: typography.h2.fontSize, ...typography.extraBold, color: colors.textPrimary },
  cardLabel: { fontSize: typography.bodySmall.fontSize, ...typography.semiBold, color: colors.textSecondary, textAlign: textAlignStart() },
}));
