// app/apps/mobile/src/components/admin/reports/ReportFilters.tsx
// FR-ADMIN-012 — target-type and age filters for the reports inbox sheet.
// Rebuilt on top of the shared filterKit (issue #1457).
import { View } from 'react-native';
import type { ListOpenReportsFilters } from '@kc/application';
import { makeUseStyles, spacing } from '@kc/ui';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { FilterSection } from '../../filterKit/FilterSection';
import { Chip } from '../../ui/Chip';
import { rowDirectionStart } from '../../../lib/rtlLayout';

export interface ReportFiltersProps {
  readonly value: ListOpenReportsFilters;
  readonly onChange: (next: ListOpenReportsFilters) => void;
}

export function countReportFilters(value: ListOpenReportsFilters): number {
  let n = 0;
  if (value.targetType) n += 1;
  if (value.maxAgeDays) n += 1;
  if (value.reporterId?.trim()) n += 1;
  if (value.search?.trim()) n += 1;
  return n;
}

export function ReportFilterSheetSections({ value, onChange }: ReportFiltersProps) {
  const styles = useStyles();
  const L = useLocaleBundle();

  const TYPES: ReadonlyArray<{ readonly key: 'all' | 'post' | 'user' | 'chat' | 'comment'; readonly label: string }> = [
    { key: 'all',  label: L.admin.reports.filters.all },
    { key: 'post', label: L.admin.reports.filters.posts },
    { key: 'user', label: L.admin.reports.filters.users },
    { key: 'chat', label: L.admin.reports.filters.chats },
    { key: 'comment', label: L.admin.reports.filters.comments },
  ];

  return (
    <>
      <FilterSection<'all' | 'post' | 'user' | 'chat' | 'comment'>
        options={TYPES.map((t) => ({ value: t.key, label: t.label }))}
        value={value.targetType ?? 'all'}
        onChange={(key) => onChange({ ...value, targetType: key === 'all' || key === null ? null : key })}
      />
      <View style={styles.ageRow}>
        <Chip
          size="sm"
          label={L.admin.reports.filters.last7Days}
          selected={value.maxAgeDays === 7}
          onPress={() => onChange({ ...value, maxAgeDays: value.maxAgeDays === 7 ? null : 7 })}
        />
        <Chip
          size="sm"
          label={L.admin.reports.filters.last30Days}
          selected={value.maxAgeDays === 30}
          onPress={() => onChange({ ...value, maxAgeDays: value.maxAgeDays === 30 ? null : 30 })}
        />
      </View>
    </>
  );
}

const useStyles = makeUseStyles(() => ({
  ageRow: {
    flexDirection: rowDirectionStart,
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
}));
