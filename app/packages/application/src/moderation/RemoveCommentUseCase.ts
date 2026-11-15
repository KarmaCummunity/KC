/** FR-ADMIN-013 AC2 — staff remove a reported comment, with its replies (restorable). */
import type { IModerationAdminRepository } from '../ports/IModerationAdminRepository';

export interface RemoveCommentInput {
  commentId: string;
}

export class RemoveCommentUseCase {
  constructor(private readonly repo: IModerationAdminRepository) {}

  async execute(input: RemoveCommentInput): Promise<void> {
    await this.repo.removeComment(input.commentId);
  }
}
