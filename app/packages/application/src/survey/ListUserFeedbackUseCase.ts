import type { AdminFeedbackEntry } from '@kc/domain';
import type { ISurveyAdminRepository } from '../ports/ISurveyAdminRepository';

export interface ListUserFeedbackInput {
  readonly limit?: number;
  /** The last entry of the previous page; omitted for the first page. */
  readonly after?: Pick<AdminFeedbackEntry, 'createdAt' | 'id'> | null;
}

export class ListUserFeedbackUseCase {
  constructor(private readonly repo: ISurveyAdminRepository) {}

  execute(input: ListUserFeedbackInput = {}): Promise<AdminFeedbackEntry[]> {
    return this.repo.listFeedback(input.limit ?? 50, input.after ?? null);
  }
}
