import type {
  AdminAuditRow,
  AdminMemberRef,
  AdminSearchCursor,
  AdminPostSearchResult,
  AdminSearchPage,
  AdminUserSearchResult,
} from '@kc/domain';

export interface AdminUserSearchFilters {
  readonly query?: string;
  readonly status?: string;
  readonly limit?: number;
  /** `nextCursor` of the previous page; omitted for the first page. */
  readonly cursor?: AdminSearchCursor | null;
}

export interface AdminPostSearchFilters {
  readonly query?: string;
  readonly status?: string;
  readonly limit?: number;
  /** `nextCursor` of the previous page; omitted for the first page. */
  readonly cursor?: AdminSearchCursor | null;
}

export interface AdminAuditSearchFilters {
  readonly targetUserId?: string;
  readonly actorId?: string;
  readonly action?: string;
  /** Inclusive lower bound on the event time. */
  readonly fromDate?: Date;
  /** Exclusive upper bound on the event time. */
  readonly toDate?: Date;
  readonly limit?: number;
  /** `nextCursor` of the previous page; omitted for the first page. */
  readonly cursor?: AdminSearchCursor | null;
}

export interface IAdminContentRepository {
  /**
   * Active members whose display name contains `text`, for the grant-role picker. Reads `users`
   * only, so a non-platform org admin (who has no staff read of account rows) can use it.
   */
  findActiveMembers(text: string, limit: number): Promise<readonly AdminMemberRef[]>;
  searchUsers(filters: AdminUserSearchFilters): Promise<AdminSearchPage<AdminUserSearchResult>>;
  searchPosts(filters: AdminPostSearchFilters): Promise<AdminSearchPage<AdminPostSearchResult>>;
  searchAudit(filters: AdminAuditSearchFilters): Promise<AdminSearchPage<AdminAuditRow>>;
}
