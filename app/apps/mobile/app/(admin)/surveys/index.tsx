// app/apps/mobile/app/(admin)/surveys/index.tsx
// FR-ADMIN-021 — Admin Portal survey results & free-feedback dashboard.
// Two tabs: "Surveys" (overview → per-survey stats + per-user answers) and
// "Feedback" (free-text entries). RBAC-gated by surveys.view.
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { PMF_SURVEY_SLUG, type AdminPermission, type AdminRole, hasPermission } from '@kc/domain';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import {
  useAdminPmfReport,
  useAdminSurveyOverview,
  useAdminSurveyResults,
  useAdminUserFeedback,
} from '../../../src/hooks/useAdminSurveys';
import { AdminListEmpty } from '../../../src/components/admin/AdminListEmpty';
import { SurveyOverviewCard } from '../../../src/components/admin/surveys/SurveyOverviewCard';
import { SurveyResultsView } from '../../../src/components/admin/surveys/SurveyResultsView';
import { FeedbackCard } from '../../../src/components/admin/surveys/FeedbackCard';
import { rowDirectionStart } from '../../../src/lib/rtlLayout';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { useAdminScreenTitle } from '../../../src/components/admin/useAdminScreenTitle';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

type Tab = 'surveys' | 'feedback';

export default function AdminSurveysScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const L = useLocaleBundle();
  const t = L.admin.surveys;
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const [tab, setTab] = useState<Tab>('surveys');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);
  const allowed = can('surveys.view');

  const overview = useAdminSurveyOverview(allowed && tab === 'surveys');
  const results = useAdminSurveyResults(allowed && selectedSlug ? selectedSlug : null);
  // The Sean Ellis survey also loads its PMF score (KC#1058).
  const pmf = useAdminPmfReport(allowed && selectedSlug === PMF_SURVEY_SLUG ? selectedSlug : null);
  const feedback = useAdminUserFeedback(allowed && tab === 'feedback');

  const portalTitle = useMemo(() => {
    if (tab === 'feedback') return `${t.title} · ${t.tabs.feedback}`;
    if (selectedSlug) {
      const item = overview.surveys.find((s) => s.slug === selectedSlug);
      return item?.titleHe ?? selectedSlug;
    }
    return t.title;
  }, [overview.surveys, selectedSlug, t.tabs.feedback, t.title, tab]);

  useAdminScreenTitle(portalTitle);

  if (rolesLoading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!allowed) {
    return (
      <View style={styles.center}>
        <Text style={styles.deniedTitle}>{t.forbiddenTitle}</Text>
      </View>
    );
  }

  const refreshing =
    tab === 'surveys'
      ? (selectedSlug ? results.isRefetching : overview.isRefetching)
      : feedback.isRefetching;

  const onRefresh = () => {
    if (tab === 'feedback') { feedback.refetch(); return; }
    if (selectedSlug) { results.refetch(); pmf.refetch(); return; }
    overview.refetch();
  };

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        <TabButton label={t.tabs.surveys} active={tab === 'surveys'} onPress={() => setTab('surveys')} />
        <TabButton label={t.tabs.feedback} active={tab === 'feedback'} onPress={() => setTab('feedback')} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {tab === 'surveys' && selectedSlug ? (
          <SurveyResultsView
            results={results.results}
            isLoading={results.isLoading}
            pmf={selectedSlug === PMF_SURVEY_SLUG ? pmf : null}
            onBack={() => setSelectedSlug(null)}
          />
        ) : tab === 'surveys' ? (
          <SurveysList
            loading={overview.isLoading}
            isEmpty={overview.surveys.length === 0}
            onSelect={setSelectedSlug}
            surveys={overview.surveys}
          />
        ) : (
          <FeedbackList loading={feedback.isLoading} entries={feedback.feedback} />
        )}
      </ScrollView>
    </View>
  );
}

function SurveysList({
  loading, isEmpty, surveys, onSelect,
}: {
  loading: boolean;
  isEmpty: boolean;
  surveys: ReturnType<typeof useAdminSurveyOverview>['surveys'];
  onSelect: (slug: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useLocaleBundle().admin.surveys.overview;
  if (loading) return <View style={styles.loadingBox}><ActivityIndicator color={colors.primary} /></View>;
  if (isEmpty) return <AdminListEmpty title={t.emptyTitle} hint={t.emptyHint} />;
  return (
    <View style={styles.list}>
      {surveys.map((s) => (
        <SurveyOverviewCard key={s.slug} item={s} onPress={() => onSelect(s.slug)} />
      ))}
    </View>
  );
}

function FeedbackList({
  loading, entries,
}: {
  loading: boolean;
  entries: ReturnType<typeof useAdminUserFeedback>['feedback'];
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useLocaleBundle().admin.surveys.feedback;
  if (loading) return <View style={styles.loadingBox}><ActivityIndicator color={colors.primary} /></View>;
  if (entries.length === 0) return <AdminListEmpty title={t.emptyTitle} hint={t.emptyHint} />;
  return (
    <View style={styles.list}>
      {entries.map((e) => <FeedbackCard key={e.id} entry={e} />)}
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]} accessibilityRole="button">
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  deniedTitle: { fontSize: typography.h3.fontSize, ...typography.bold, color: colors.textPrimary, textAlign: 'center' },
  loadingBox: { paddingVertical: spacing['2xl'], alignItems: 'center' },
  tabs: {
    flexDirection: rowDirectionStart,
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primarySurface, borderColor: colors.primaryLight },
  tabText: { fontSize: typography.body.fontSize, ...typography.bold, color: colors.textSecondary },
  tabTextActive: { color: colors.primaryDark },
  content: {
    padding: spacing.base,
    paddingBottom: spacing['2xl'],
    gap: spacing.md,
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
  },
  list: { gap: spacing.md },
}));
