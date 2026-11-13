import type { AdminTaskPage } from '@kc/domain';
import type { AdminTaskListFilters, IAdminTaskRepository } from './IAdminTaskRepository';

export class ListAdminTasksUseCase {
  constructor(private readonly repo: IAdminTaskRepository) {}

  async execute(filters: AdminTaskListFilters): Promise<AdminTaskPage> {
    return this.repo.list(filters);
  }
}

/** FR-ADMIN-018 — the dashboard card: open and in-progress tasks. */
export class CountOpenAdminTasksUseCase {
  constructor(private readonly repo: IAdminTaskRepository) {}

  execute(): Promise<number> {
    return this.repo.openCount();
  }
}
