// app/apps/mobile/src/components/admin/tasks/TaskAssigneeFilter.tsx
// V2-ADMIN-TASKS-3 — 3-state assignee filter for the /admin/tasks list.
//   value = null               → no filter ("all")
//   value = 'unassigned'       → only tasks with no assignee
//   value = '<userId>'         → only tasks assigned to that admin
// Rebuilt on top of the shared filterKit (issue #1457).
import { useQuery } from '@tanstack/react-query';
import { StyleSheet } from 'react-native';
import { FilterChipRow } from '../../filterKit/FilterChipRow';
import type { AdminGrant } from '@kc/domain';
import { spacing } from '@kc/ui';
import { container } from '../../../lib/container';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export const UNASSIGNED_TOKEN = 'unassigned' as const;
export type AssigneeFilterValue = null | typeof UNASSIGNED_TOKEN | string;

export interface TaskAssigneeFilterProps {
  readonly value: AssigneeFilterValue;
  readonly onChange: (next: AssigneeFilterValue) => void;
}

export function TaskAssigneeFilter({ value, onChange }: TaskAssigneeFilterProps) {
  const L = useLocaleBundle();
  const q = useQuery({
    queryKey: ['admin.admins.list', { includeRevoked: false }],
    queryFn:  () => container.listAdmins.execute({ includeRevoked: false }),
    staleTime: 60_000,
  });

  const seen = new Set<string>();
  const entries: { userId: string; displayName: string }[] = [];
  for (const g of (q.data ?? []) as readonly AdminGrant[]) {
    if (g.revokedAt !== null) continue;
    if (seen.has(g.userId)) continue;
    seen.add(g.userId);
    entries.push({ userId: g.userId, displayName: g.displayName ?? L.admin.admins.row.unnamed });
  }

  const options = [
    { value: UNASSIGNED_TOKEN, label: L.admin.tasks.assigneeFilter.unassigned },
    ...entries.map((e) => ({ value: e.userId, label: e.displayName })),
  ];

  return (
    <FilterChipRow<string>
      showAllChip
      allLabel={L.admin.tasks.assigneeFilter.all}
      options={options}
      value={value}
      onChange={(v) => onChange(v as AssigneeFilterValue)}
      contentContainerStyle={styles.row}
    />
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingHorizontal: spacing.base, paddingBottom: spacing.sm },
});
