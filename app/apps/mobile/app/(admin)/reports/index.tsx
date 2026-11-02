// app/apps/mobile/app/(admin)/reports/index.tsx
// FR-ADMIN-012 — admin reports inbox screen. Cursor-paginated KcFlashList of
// open reports with chip filters and reporter-id search.
import { useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { spacing, Text, typography } from '@kc/ui';
import type { ListOpenReportsFilters } from '@kc/application';
import { useReportsInbox } from '../../../src/hooks/useReportsInbox';
import { AdminScreenHeader } from '../../../src/components/admin/AdminScreenHeader';
import { ReportFilters } from '../../../src/components/admin/reports/ReportFilters';
import { ReportRow } from '../../../src/components/admin/reports/ReportRow';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function ReportsInbox() {
  const L = useLocaleBundle();
  const [filters, setFilters] = useState<ListOpenReportsFilters>({});
  const q = useReportsInbox(filters);
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <View style={styles.root}>
      <AdminScreenHeader title={L.admin.reports.inboxTitle} />
      <ReportFilters value={filters} onChange={setFilters} />
      <KcFlashList
        data={rows}
        keyExtractor={(r) => `${r.targetType}:${r.targetId}`}
        renderItem={({ item }) => <ReportRow row={item} />}
        onEndReached={() => {
          if (q.hasNextPage) void q.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={q.isRefetching}
            onRefresh={() => {
              void q.refetch();
            }}
          />
        }
        ListEmptyComponent={
          !q.isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{L.admin.reports.emptyTitle}</Text>
              <Text style={styles.emptyHint}>{L.admin.reports.emptyHint}</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:       { flex: 1 },
  empty:      { padding: spacing['2xl'], alignItems: 'center', gap: spacing.sm },
  emptyTitle: { fontSize: typography.bodyLarge.fontSize, ...typography.semiBold },
  emptyHint:  { fontSize: typography.bodySmall.fontSize, opacity: 0.6, textAlign: 'center' },
});