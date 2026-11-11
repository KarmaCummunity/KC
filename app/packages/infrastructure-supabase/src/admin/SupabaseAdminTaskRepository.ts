// FR-ADMIN-018 — internal admin task tracker.
//
// The production baseline has no task tracker (docs/db/app-migration-map.md, M19): back-office
// tools are internal data, and whether they belong in this database is an open product
// decision. The adapter therefore makes no call: every method reports the capability as
// missing with `BackendUnavailableError`, and the admin portal hides the tasks section
// (apps/mobile/src/lib/parkedFeatures.ts). The previous RPC adapter is in git history.
import type {
  AdminTaskListFilters,
  CreateAdminTaskInput,
  IAdminTaskRepository,
  UpdateAdminTaskInput,
} from '@kc/application';
import {
  BackendUnavailableError,
  type AdminTask,
  type AdminTaskStatus,
  type AdminTaskWithActivities,
} from '@kc/domain';

const unavailable = (rpc: string): Promise<never> =>
  Promise.reject(new BackendUnavailableError(`rpc:${rpc}`, 'function'));

export class SupabaseAdminTaskRepository implements IAdminTaskRepository {
  list(_filters: AdminTaskListFilters): Promise<readonly AdminTask[]> {
    return unavailable('admin_task_list');
  }

  getDetail(_taskId: string): Promise<AdminTaskWithActivities | null> {
    return unavailable('admin_task_detail');
  }

  create(_input: CreateAdminTaskInput): Promise<string> {
    return unavailable('admin_task_create');
  }

  update(_taskId: string, _patch: UpdateAdminTaskInput): Promise<void> {
    return unavailable('admin_task_update');
  }

  setStatus(_taskId: string, _newStatus: AdminTaskStatus): Promise<void> {
    return unavailable('admin_task_set_status');
  }

  assign(_taskId: string, _newAssigneeId: string | null): Promise<void> {
    return unavailable('admin_task_assign');
  }

  addComment(_taskId: string, _body: string): Promise<string> {
    return unavailable('admin_task_add_comment');
  }

  delete(_taskId: string): Promise<void> {
    return unavailable('admin_task_delete');
  }
}
