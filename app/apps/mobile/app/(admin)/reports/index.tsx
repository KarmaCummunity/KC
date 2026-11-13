// app/apps/mobile/app/(admin)/reports/index.tsx
// FR-ADMIN-012 — admin reports inbox screen. Cursor-paginated KcFlashList of
// open report cases (grouped on the server) with chip filters and a search by target id or
// reporter name (AC3).
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { spacing, Text, typography } from '@kc/ui';
import type { ListOpenReportsFilters } from '@kc/application';
import type { ReportInboxRow } from '@kc/domain';
import { useReportsInbox } from '../../../src/hooks/useReportsInbox';
import { AdminSearchFilterToolbar } from '../../../src/components/admin/AdminSearchFilterToolbar';
import {
  countReportFilters,
  ReportFilterSheetSections,
} from '../../../src/components/admin/reports/ReportFilters';
import { ReportRow } from '../../../src/components/admin/reports/ReportRow';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

const reportKeyExtractor = (r: ReportInboxRow) => `${r.targetType}:${r.targetId}`;

export default function ReportsInbox() {
  const L = useLocaleBundle();
  const [filters, setFilters] = useState<ListOpenReportsFilters>({});
  const [searchDraft, setSearchDraft] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const q = useReportsInbox(filters);
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data?.pages]);

  const renderItem = useCallback(
    ({ item }: { item: ReportInboxRow }) => <ReportRow row={item} />,
    [],
  );

  const handleEndReached = useCallback(() => {
    if (q.hasNextPage) void q.fetchNextPage();
  }, [q]);

  const commitSearch = () => {
    const text = searchDraft.trim();
    setFilters((prev) => ({ ...prev, search: text || null }));
  };

  const clearFilters = () => {
    setFilters({});
    setSearchDraft('');
  };

  return (
    <View style={styles.root}>
      <AdminSearchFilterToolbar
        search={{
          value: searchDraft,
          onChangeText: setSearchDraft,
          onSubmitEditing: commitSearch,
          placeholder: L.admin.reports.filters.search,
          autoCapitalize: 'none',
          testID: 'admin-reports-reporter-search',
        }}
        activeFilterCount={countReportFilters(filters)}
        filterVisible={sheetOpen}
        onOpenFilters={() => setSheetOpen(true)}
        onCloseFilters={() => setSheetOpen(false)}
        onClearFilters={clearFilters}
        filterButtonTestID="admin-reports-filter-button"
        filterSheetContent={<ReportFilterSheetSections value={filters} onChange={setFilters} />}
      />
      <KcFlashList
        data={rows}
        keyExtractor={reportKeyExtractor}
        estimatedItemSize={84}
        renderItem={renderItem}
        onEndReached={handleEndReached}
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
