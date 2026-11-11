/** FR-MOD-002 / FR-CHAT-007 AC3 — validate and submit a support issue. */
import type { Chat } from '@kc/domain';
import type { IChatRepository } from '../ports/IChatRepository';
import { ChatError } from './errors';

/** Fewest visible characters a support-issue description needs (FR-MOD-002 AC1). */
export const SUPPORT_ISSUE_DESCRIPTION_MIN = 10;

/** Most characters a support-issue description may have, after trim (FR-MOD-002 AC6, #2096). */
export const SUPPORT_ISSUE_DESCRIPTION_MAX = 500;

export interface SubmitSupportIssueInput {
  category: string | null;
  description: string;
}

export class SubmitSupportIssueUseCase {
  constructor(private readonly repo: IChatRepository) {}

  /**
   * Trims the description, checks its length bounds, then opens or resumes the support
   * thread with the report as a system message. The server (`rpc_submit_support_issue`)
   * enforces the same bounds, so another client cannot bypass them.
   */
  async execute(input: SubmitSupportIssueInput): Promise<Chat> {
    const description = input.description.trim();
    if (description.length < SUPPORT_ISSUE_DESCRIPTION_MIN) {
      throw new ChatError('description_too_short', 'description_too_short');
    }
    if (description.length > SUPPORT_ISSUE_DESCRIPTION_MAX) {
      throw new ChatError('description_too_long', 'description_too_long');
    }
    return this.repo.submitSupportIssue(input.category, description);
  }
}
