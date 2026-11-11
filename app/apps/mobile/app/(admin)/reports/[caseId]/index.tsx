// app/apps/mobile/app/(admin)/reports/[caseId]/index.tsx
// FR-ADMIN-013 — case detail screen.
// caseId encodes "<target_type>:<target_id>" (URL-encoded). The same encoding
// is the routing contract for deep-links (e.g. from chat ReportReceivedBubble
// or future notification taps).
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminReportTargetType } from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { useReportCaseDetail } from '../../../../src/hooks/useReportCaseDetail';
import { CaseReporterList } from '../../../../src/components/admin/reports/CaseReporterList';
import { CaseAuditTimeline } from '../../../../src/components/admin/reports/CaseAuditTimeline';
import { CaseActions } from '../../../../src/components/admin/reports/CaseActions';
import { CaseTargetCard } from '../../../../src/components/admin/reports/CaseTargetCard';
import { useLocaleBundle } from '../../../../src/i18n/useLocaleBundle';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

function parseCaseId(
  raw: string | undefined,
): { type: AdminReportTargetType; id: string } | null {
  if (!raw) return null;
  const decoded = decodeURIComponent(raw);
  // Target IDs can themselves contain ':' so split on the first one only.
  const idx = decoded.indexOf(':');
  if (idx <= 0) return null;
  const type = decoded.slice(0, idx);
  const id = decoded.slice(idx + 1);
  if (!id) return null;
  if (type !== 'post' && type !== 'user' && type !== 'chat' && type !== 'comment') return null;
  return { type, id };
}

export default function CaseDetail() {
  const { caseId } = useLocalSearchParams<{ caseId: string }>();
  const parsed = parseCaseId(caseId);
  const { data, isLoading } = useReportCaseDetail(
    parsed?.type ?? null,
    parsed?.id ?? null,
  );
  const queryClient = useQueryClient();
  const styles = useStyles();
  const L = useLocaleBundle();

  if (!parsed) {
    return (
      <View style={styles.center}>
        <Text>{L.admin.caseDetail.notFound}</Text>
      </View>
    );
  }
  if (isLoading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>{L.admin.caseDetail.loading}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.title}>{L.admin.caseDetail.title}</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{L.admin.caseDetail.targetSection}</Text>
        <CaseTargetCard
          targetType={data.targetType}
          targetId={data.targetId}
          target={data.target}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{L.admin.caseDetail.actions}</Text>
        <CaseActions
          detail={data}
          onActed={() => {
            // After a successful action all open reports on this target are
            // resolved, so the case will drop out of the inbox. Refresh both
            // the case detail and inbox queries, then return to the inbox so
            // the admin isn't stranded on an empty case screen.
            void queryClient.invalidateQueries({ queryKey: ['admin.reports.case'] });
            void queryClient.invalidateQueries({ queryKey: ['admin.reports.inbox'] });
            router.back();
          }}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{L.admin.caseDetail.reporters}</Text>
        <CaseReporterList reporters={data.reporters} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{L.admin.caseDetail.timeline}</Text>
        <CaseAuditTimeline entries={data.timeline} />
      </View>
    </ScrollView>
  );
}

const useStyles = makeUseStyles(() => ({
  root:         { padding: spacing.base, gap: spacing.base },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  title:        { fontSize: typography.h3.fontSize, ...typography.bold },
  section:      { gap: spacing.sm },
  sectionTitle: { fontSize: typography.body.fontSize, ...typography.semiBold, opacity: 0.7 },
}));
