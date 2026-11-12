import type {
  AdminTaskCategory,
  AdminTaskPage,
  AdminTaskPriority,
  AdminTaskStatus,
  AdminTaskWithActivities,
} from '@kc/domain';

export interface AdminTaskListFilters {
  readonly status?: AdminTaskStatus;
  readonly assigneeId?: string;
  /** When true, returns only tasks with no assignee. Mutually exclusive with `assigneeId`. */
  readonly unassignedOnly?: boolean;
  readonly onlyMine?: boolean;
  readonly overdue?: boolean;
  readonly priority?: AdminTaskPriority;
  readonly category?: AdminTaskCategory;
  readonly label?: string;
  /** Inclusive lower bound on `due_at`. */
  readonly dueFrom?: Date;
  /** Inclusive upper bound on `due_at`. */
  readonly dueTo?: Date;
  readonly limit?: number;
  /** `nextCursor` of the previous page; omitted for the first page. */
  readonly cursor?: string;
}

export interface CreateAdminTaskInput {
  readonly title: string;
  readonly description?: string | null;
  readonly priority?: AdminTaskPriority;
  readonly category?: AdminTaskCategory;
  readonly assigneeId?: string | null;
  readonly dueAt?: Date | null;
  readonly labels?: readonly string[];
}

export interface UpdateAdminTaskInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly priority?: AdminTaskPriority;
  readonly category?: AdminTaskCategory;
  readonly dueAt?: Date | null;
  readonly clearDue?: boolean;
  readonly labels?: readonly string[];
}

export interface IAdminTaskRepository {
  list(filters: AdminTaskListFilters): Promise<AdminTaskPage>;
  /** Tasks still being worked on (open or in progress), for the dashboard. */
  openCount(): Promise<number>;
  getDetail(taskId: string): Promise<AdminTaskWithActivities | null>;
  create(input: CreateAdminTaskInput): Promise<string>;
  update(taskId: string, patch: UpdateAdminTaskInput): Promise<void>;
  setStatus(taskId: string, newStatus: AdminTaskStatus): Promise<void>;
  assign(taskId: string, newAssigneeId: string | null): Promise<void>;
  addComment(taskId: string, body: string): Promise<string>;
  delete(taskId: string): Promise<void>;
}
