import { canTransition } from '../fsm/machine';
import { adminTaskMachine } from '../fsm/machines/adminTask';

export const ADMIN_TASK_STATUSES = [
  'open',
  'in_progress',
  'blocked',
  'done',
  'archived',
] as const;
export type AdminTaskStatus = (typeof ADMIN_TASK_STATUSES)[number];

export const ADMIN_TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type AdminTaskPriority = (typeof ADMIN_TASK_PRIORITIES)[number];

/**
 * V2-ADMIN-TASKS-2 — curated single-select category for admin tasks.
 * Free-form labels stay separate (sub-tags within a category).
 */
export const ADMIN_TASK_CATEGORIES = [
  'moderation',
  'support',
  'engineering',
  'product',
  'operations',
  'marketing',
  'finance',
  'other',
] as const;
export type AdminTaskCategory = (typeof ADMIN_TASK_CATEGORIES)[number];

export const ADMIN_TASK_CATEGORY_DEFAULT: AdminTaskCategory = 'other';

export interface AdminTask {
  readonly taskId: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: AdminTaskStatus;
  readonly priority: AdminTaskPriority;
  readonly category: AdminTaskCategory;
  readonly assigneeId: string | null;
  readonly assigneeDisplayName: string | null;
  readonly createdBy: string;
  readonly createdByDisplayName: string | null;
  readonly dueAt: Date | null;
  readonly labels: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly commentCount: number;
}

export function isStatusTransitionAllowed(
  from: AdminTaskStatus,
  to: AdminTaskStatus,
): boolean {
  return canTransition(adminTaskMachine, from, to).ok;
}

export function parseAdminTaskStatus(value: string | null | undefined): AdminTaskStatus | null {
  if (value == null) return null;
  return (ADMIN_TASK_STATUSES as readonly string[]).includes(value)
    ? (value as AdminTaskStatus)
    : null;
}

export function parseAdminTaskPriority(value: string | null | undefined): AdminTaskPriority | null {
  if (value == null) return null;
  return (ADMIN_TASK_PRIORITIES as readonly string[]).includes(value)
    ? (value as AdminTaskPriority)
    : null;
}

export function parseAdminTaskCategory(value: string | null | undefined): AdminTaskCategory | null {
  if (value == null) return null;
  return (ADMIN_TASK_CATEGORIES as readonly string[]).includes(value)
    ? (value as AdminTaskCategory)
    : null;
}

/** Same as parseAdminTaskCategory but falls back to 'other' for unknown / nullish. */
export function coerceAdminTaskCategory(value: string | null | undefined): AdminTaskCategory {
  return parseAdminTaskCategory(value) ?? ADMIN_TASK_CATEGORY_DEFAULT;
}

export function isOverdue(task: AdminTask, now: Date = new Date()): boolean {
  if (task.dueAt === null) return false;
  if (task.status === 'done' || task.status === 'archived') return false;
  return task.dueAt.getTime() < now.getTime();
}
