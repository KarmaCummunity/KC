// FR-ADMIN-018 — admin task tracker over the admin_task_* RPCs (supabase/migrations/0034).
//
// The tables live in kc_private; every call goes through a definer RPC that checks the
// caller's staff role. The list is keyset-paged (`cursor`), and refusals map to
// `AdminTaskError` by their stable message.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AdminTaskListFilters,
  CreateAdminTaskInput,
  IAdminTaskRepository,
  UpdateAdminTaskInput,
} from '@kc/application';
import {
  AdminTaskError,
  type AdminTaskPage,
  type AdminTaskStatus,
  type AdminTaskWithActivities,
} from '@kc/domain';
import type { Database } from '../database.types';
import { toBackendUnavailable } from '../rpc/backendUnavailable';
import type { CallResult } from '../rpc/mapRpcError';
import { mapAdminTask, mapAdminTaskActivities, toAdminTaskError } from './adminTaskRows';
import { asRecord, decodeCursor, readPage } from './backOfficePaging';

type Client = SupabaseClient<Database>;

const DEFAULT_PAGE = 50;

function unwrap<T>(rpc: string, result: CallResult<T>): T {
  if (!result.error) return result.data;
  throw toBackendUnavailable(`rpc:${rpc}`, result.error) ?? toAdminTaskError(result.error);
}

const iso = (value: Date | null | undefined): string | undefined => value?.toISOString();

export class SupabaseAdminTaskRepository implements IAdminTaskRepository {
  constructor(private readonly client: Client) {}

  async list(filters: AdminTaskListFilters): Promise<AdminTaskPage> {
    const limit = filters.limit ?? DEFAULT_PAGE;
    const rows = unwrap('admin_task_list', await this.client.rpc('admin_task_list', {
      p_status: filters.status,
      p_assignee: filters.assigneeId,
      p_only_mine: filters.onlyMine ?? false,
      p_overdue: filters.overdue ?? false,
      p_priority: filters.priority,
      p_label: filters.label,
      p_category: filters.category,
      p_due_from: iso(filters.dueFrom),
      p_due_to: iso(filters.dueTo),
      p_unassigned_only: filters.unassignedOnly ?? false,
      p_limit: limit,
      p_cursor: decodeCursor(filters.cursor) ?? undefined,
    }));
    return readPage(rows, limit, (row) => mapAdminTask(row.task));
  }

  async openCount(): Promise<number> {
    return unwrap('admin_task_open_count', await this.client.rpc('admin_task_open_count')) ?? 0;
  }

  async getDetail(taskId: string): Promise<AdminTaskWithActivities | null> {
    const data = unwrap('admin_task_detail', await this.client.rpc('admin_task_detail', { p_task_id: taskId }));
    const task = mapAdminTask(data);
    if (task === null) return null;
    return { task, activities: mapAdminTaskActivities(asRecord(data)?.activities) };
  }

  async create(input: CreateAdminTaskInput): Promise<string> {
    const id = unwrap('admin_task_create', await this.client.rpc('admin_task_create', {
      p_title: input.title,
      p_description: input.description ?? undefined,
      p_priority: input.priority ?? 'medium',
      p_assignee_id: input.assigneeId ?? undefined,
      p_due_at: iso(input.dueAt),
      p_labels: input.labels ? [...input.labels] : [],
      p_category: input.category ?? 'other',
    }));
    if (typeof id !== 'string') throw new AdminTaskError('unknown', 'admin_task_create returned no id');
    return id;
  }

  async update(taskId: string, patch: UpdateAdminTaskInput): Promise<void> {
    unwrap('admin_task_update', await this.client.rpc('admin_task_update', {
      p_task_id: taskId,
      p_title: patch.title,
      // An explicit null clears the description; the RPC reads an empty string as "clear".
      p_description: patch.description === null ? '' : patch.description,
      p_priority: patch.priority,
      p_due_at: iso(patch.dueAt),
      p_clear_due: patch.clearDue ?? false,
      p_labels: patch.labels ? [...patch.labels] : undefined,
      p_category: patch.category,
    }));
  }

  async setStatus(taskId: string, newStatus: AdminTaskStatus): Promise<void> {
    unwrap('admin_task_set_status', await this.client.rpc('admin_task_set_status', {
      p_task_id: taskId, p_new_status: newStatus,
    }));
  }

  async assign(taskId: string, newAssigneeId: string | null): Promise<void> {
    unwrap('admin_task_assign', await this.client.rpc('admin_task_assign', {
      p_task_id: taskId,
      // `null` unassigns; the generated type does not spell out the nullable argument.
      p_new_assignee: newAssigneeId as string,
    }));
  }

  async addComment(taskId: string, body: string): Promise<string> {
    const id = unwrap('admin_task_add_comment', await this.client.rpc('admin_task_add_comment', {
      p_task_id: taskId, p_body: body,
    }));
    if (typeof id !== 'string') throw new AdminTaskError('unknown', 'admin_task_add_comment returned no id');
    return id;
  }

  async delete(taskId: string): Promise<void> {
    unwrap('admin_task_delete', await this.client.rpc('admin_task_delete', { p_task_id: taskId }));
  }
}
