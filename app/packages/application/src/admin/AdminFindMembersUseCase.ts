import type { AdminMemberRef } from '@kc/domain';
import type { IAdminContentRepository } from './IAdminContentRepository';

/** Characters needed before the lookup runs; fewer would match most of the community. */
export const MIN_MEMBER_LOOKUP_CHARS = 2;
/** Members offered at most. */
export const MEMBER_LOOKUP_LIMIT = 8;

/** FR-ADMIN-016 — finds active members by display name for the grant-role modal. */
export class AdminFindMembersUseCase {
  constructor(private readonly repo: IAdminContentRepository) {}

  async execute(text: string): Promise<readonly AdminMemberRef[]> {
    const trimmed = text.trim();
    if (trimmed.length < MIN_MEMBER_LOOKUP_CHARS) return [];
    return this.repo.findActiveMembers(trimmed, MEMBER_LOOKUP_LIMIT);
  }
}
