// app/apps/mobile/src/hooks/useAdminTasks.ts
// FR-ADMIN-018 — admin tasks list (keyset-paged), detail and the dashboard's open count.
import { useQuery } from '@tanstack/react-query';
import type { AdminTask, AdminTaskWithActivities } from '@kc/domain';
import type { AdminTaskListFilters } from '@kc/application';
import { container } from '../lib/container';
import { ADMIN_TASKS_AVAILABLE } from '../lib/parkedFeatures';
import { useKeysetPages } from './useKeysetPages';

export function useAdminTasksList(filters: Omit<AdminTaskListFilters, 'cursor'>) {
  const list = useKeysetPages<AdminTask, Omit<AdminTaskListFilters, 'cursor'>>(
    ['admin.tasks.list'], filters, (f) => container.listAdminTasks.execute(f), ADMIN_TASKS_AVAILABLE,
  );
  return { ...list, tasks: list.rows };
}

/** Open and in-progress tasks, for the dashboard card. */
export function useAdminOpenTaskCount(enabled: boolean) {
  const q = useQuery({
    queryKey: ['admin.tasks.openCount'],
    queryFn: () => container.countOpenAdminTasks.execute(),
    enabled: enabled && ADMIN_TASKS_AVAILABLE,
    staleTime: 30_000,
  });
  return { count: q.data ?? null, isLoading: q.isLoading };
}

export function useAdminTaskDetail(taskId: string | null | undefined) {
  const q = useQuery<AdminTaskWithActivities | null>({
    queryKey: ['admin.tasks.detail', taskId ?? ''],
    queryFn:  () => container.getAdminTaskDetail.execute(taskId ?? ''),
    enabled:  Boolean(taskId) && ADMIN_TASKS_AVAILABLE,
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
