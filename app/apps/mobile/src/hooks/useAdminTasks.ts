// app/apps/mobile/src/hooks/useAdminTasks.ts
// FR-ADMIN-018 — admin tasks list + detail queries.
import { useQuery } from '@tanstack/react-query';
import type { AdminTask, AdminTaskWithActivities } from '@kc/domain';
import type { AdminTaskListFilters } from '@kc/application';
import { container } from '../lib/container';
import { BACK_OFFICE_TOOLS_AVAILABLE } from '../lib/parkedFeatures';

const EMPTY: readonly AdminTask[] = [];

export function useAdminTasksList(filters: AdminTaskListFilters) {
  const q = useQuery({
    queryKey: ['admin.tasks.list', filters],
    queryFn:  () => container.listAdminTasks.execute(filters),
    // M19: no task tracker in the production baseline; the call would only be refused.
    enabled:  BACK_OFFICE_TOOLS_AVAILABLE,
    staleTime: 30_000,
  });
  return {
    tasks:        q.data ?? EMPTY,
    isLoading:    q.isLoading,
    isRefetching: q.isRefetching,
    refetch:      () => { void q.refetch(); },
    error:        q.error,
  };
}

export function useAdminTaskDetail(taskId: string | null | undefined) {
  const q = useQuery<AdminTaskWithActivities | null>({
    queryKey: ['admin.tasks.detail', taskId ?? ''],
    queryFn:  () => container.getAdminTaskDetail.execute(taskId ?? ''),
    enabled:  Boolean(taskId),
    staleTime: 10_000,
  });
  return {
    detail:       q.data ?? null,
    isLoading:    q.isLoading,
    isRefetching: q.isRefetching,
    refetch:      () => { void q.refetch(); },
    error:        q.error,
  };
}
