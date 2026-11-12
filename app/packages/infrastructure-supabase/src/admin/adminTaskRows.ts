// FR-ADMIN-018 — maps the JSON records of the admin_task_* RPCs (migration 0021) to domain tasks.
import {
  AdminTaskError,
  coerceAdminTaskCategory,
  parseAdminTaskActivityKind,
  parseAdminTaskPriority,
  parseAdminTaskStatus,
  type AdminTask,
  type AdminTaskActivity,
  type AdminTaskErrorCode,
} from '@kc/domain';
import type { Json } from '../database.types';
import type { BackendErrorLike } from '../rpc/backendUnavailable';
import { asRecord, date, str, strings } from './backOfficePaging';

const KNOWN_ERRORS: ReadonlySet<string> = new Set<AdminTaskErrorCode>([
  'forbidden', 'invalid_title', 'title_too_long', 'invalid_priority', 'invalid_category',
  'invalid_status', 'invalid_transition', 'invalid_input', 'task_not_found',
  'assignee_not_admin', 'empty_comment', 'comment_too_long',
]);

/** The task error of a refused call: by its stable message, else by SQLSTATE. */
export function toAdminTaskError(err: BackendErrorLike): AdminTaskError {
  const message = err.message ?? '';
  if (KNOWN_ERRORS.has(message)) return new AdminTaskError(message as AdminTaskErrorCode);
  if (err.code === '42501') return new AdminTaskError('forbidden');
  return new AdminTaskError('unknown', message || 'admin task call failed');
}

/** A task record; null when it is not an object or its status or priority is unknown. */
export function mapAdminTask(value: Json | undefined): AdminTask | null {
  const row = asRecord(value);
  if (row === null) return null;
  const taskId = str(row, 'task_id');
  const title = str(row, 'title');
  const status = parseAdminTaskStatus(str(row, 'status'));
  const priority = parseAdminTaskPriority(str(row, 'priority'));
  const createdAt = date(row, 'created_at');
  if (taskId === null || title === null || status === null || priority === null || createdAt === null) return null;
  const commentCount = row.comment_count;
  return {
    taskId,
    title,
    description: str(row, 'description'),
    status,
    priority,
    category: coerceAdminTaskCategory(str(row, 'category')),
    assigneeId: str(row, 'assignee_id'),
    assigneeDisplayName: str(row, 'assignee_display_name'),
    createdBy: str(row, 'created_by'),
    createdByDisplayName: str(row, 'created_by_display_name'),
    dueAt: date(row, 'due_at'),
    labels: strings(row, 'labels'),
    createdAt,
    updatedAt: date(row, 'updated_at') ?? createdAt,
    commentCount: typeof commentCount === 'number' ? commentCount : 0,
  };
}

/** The history entries of a detail record; entries of an unknown kind are skipped. */
export function mapAdminTaskActivities(value: Json | undefined): AdminTaskActivity[] {
  if (!Array.isArray(value)) return [];
  const out: AdminTaskActivity[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (row === null) continue;
    const activityId = str(row, 'activity_id');
    const kind = parseAdminTaskActivityKind(str(row, 'kind'));
    const createdAt = date(row, 'created_at');
    if (activityId === null || kind === null || createdAt === null) continue;
    out.push({
      activityId,
      actorId: str(row, 'actor_id'),
      actorDisplayName: str(row, 'actor_display_name'),
      kind,
      payload: asRecord(row.payload) ?? {},
      createdAt,
    });
  }
  return out;
}
