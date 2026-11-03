// app/apps/mobile/src/components/admin/reports/ReportFilters.tsx
// FR-ADMIN-012 — chip-based target/age filters + reporter-id search.
// Rebuilt on top of the shared filterKit (issue #1457).
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ListOpenReportsFilters } from '@kc/application';
import { makeUseStyles, spacing } from '@kc/ui';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { FilterChipRow } from '../../filterKit/FilterChipRow';
import { FilterSearchBar } from '../../filterKit/FilterSearchBar';
import { Chip } from '../../ui/Chip';

export interface ReportFiltersProps {
  readonly value: ListOpenReportsFilters;
  readonly onChange: (next: ListOpenReportsFilters) => void;
}

export function ReportFilters({ value, onChange }: ReportFiltersProps) {
  const [reporter, setReporter] = useState(value.reporterId ?? '');
  const styles = useStyles();
  const L = useLocaleBundle();

  const TYPES: ReadonlyArray<{ readonly key: 'all' | 'post' | 'user' | 'chat' | 'listing'; readonly label: string }> = [
    { key: 'all',  label: L.admin.reports.filters.all },
    { key: 'post', label: L.admin.reports.filters.posts },
    { key: 'user', label: L.admin.reports.filters.users },
    { key: 'chat', label: L.admin.reports.filters.chats },
    { key: 'listing', label: L.admin.reports.filters.listings },
  ];

  return (
    <View style={styles.root}>
      <FilterChipRow<'all' | 'post' | 'user' | 'chat' | 'listing'>
        scrollable
        options={TYPES.map((t) => ({
          value: t.key,
          label: t.label,
        }))}
        value={value.targetType ?? 'all'}
        onChange={(key) => onChange({ ...value, targetType: key === 'all' || key === null ? null : key })}
      >
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
      </FilterChipRow>
      <FilterSearchBar
        placeholder={L.admin.reports.filters.search}
        value={reporter}
        onChangeText={setReporter}
        onSubmitEditing={() => onChange({ ...value, reporterId: reporter || null })}
        style={styles.searchWrap}
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  searchWrap: { marginBottom: 0 },
}));
