export interface AdminUserSearchResult {
  readonly userId: string;
  readonly displayName: string | null;
  readonly shareHandle: string | null;
  readonly accountStatus: string;
  /** City id; the screen resolves its name from the cached city list. */
  readonly cityId: string | null;
  readonly createdAt: Date;
}

/** A member picked from the grant-role lookup: just enough to name them. */
export interface AdminMemberRef {
  readonly userId: string;
  readonly displayName: string | null;
}

export interface AdminPostSearchResult {
  readonly postId: string;
  readonly title: string | null;
  readonly type: string;
  readonly status: string;
  readonly visibility: string;
  readonly ownerId: string;
  readonly ownerDisplayName: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AdminAuditRow {
  readonly eventId: string;
  readonly actorId: string | null;
  readonly actorDisplayName: string | null;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly targetDisplayName: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
}

/** Opaque keyset position of a search page: the adapter that issued it is the only reader. */
export type AdminSearchCursor = Readonly<Record<string, unknown>>;

/** One keyset page of an admin search; `nextCursor` is null on the last page. */
export interface AdminSearchPage<T> {
  readonly rows: readonly T[];
  readonly nextCursor: AdminSearchCursor | null;
}

export class AdminContentError extends Error {
  readonly code: 'forbidden' | 'invalid_input' | 'unknown';

  constructor(code: AdminContentError['code'], message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'AdminContentError';
  }
}

export function isAdminContentError(err: unknown): err is AdminContentError {
  return err instanceof AdminContentError;
}
