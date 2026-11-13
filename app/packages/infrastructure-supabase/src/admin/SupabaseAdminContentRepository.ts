import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AdminAuditSearchFilters,
  AdminPostSearchFilters,
  AdminUserSearchFilters,
  IAdminContentRepository,
} from '@kc/application';
import {
  AdminContentError,
  BackendUnavailableError,
  type AdminAuditRow,
  type AdminMemberRef,
  type AdminPostSearchResult,
  type AdminSearchPage,
  type AdminUserSearchResult,
} from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { loadDisplayNames } from '../reports/reportTargetPreviews';
import { callAuditSearch } from './auditSearchCall';
import { refusalReason } from './refusalReason';

type Client = SupabaseClient<Database>;

/** Rows per page when the caller names none. */
const DEFAULT_LIMIT = 50;
/** `admin_audit_search` serves at most 200 rows; one extra row is read to know if more remain. */
const AUDIT_MAX_LIMIT = 199;

/** A member row with its account status, as the embedded staff read returns it. */
interface UserRow {
  id: string;
  display_name: string | null;
  share_handle: string;
  city_id: string | null;
  created_at: string;
  user_account: { status: string } | { status: string }[] | null;
}

/** Maps a failed staff read to `AdminContentError`; a missing backend object stays unavailable. */
function toContentError(error: unknown): unknown {
  if (error instanceof BackendUnavailableError || error instanceof AdminContentError) return error;
  const reason = refusalReason(error);
  if (reason === 'forbidden' || reason === 'unauthenticated') return new AdminContentError('forbidden');
  if (reason === 'invalid_input') return new AdminContentError('invalid_input');
  return new AdminContentError('unknown', error instanceof Error ? error.message : undefined);
}

/** Runs a staff read and maps its failure, so each search method reads as one expression. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toContentError(error);
  }
}

/**
 * The text as a PostgREST `ilike` pattern. The characters that carry meaning inside an
 * `or(...)` filter list (`,` `(` `)`) and inside a pattern (`%` `*` `\`) are dropped.
 */
function likePattern(text: string): string {
  return `%${text.replace(/[,()%*\\]/g, ' ').trim()}%`;
}

/** Splits `rows` fetched with one extra row into the page and the cursor of its last row. */
function pageOf<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (last: T) => Record<string, unknown>,
): { rows: T[]; nextCursor: Record<string, unknown> | null } {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { rows: page, nextCursor: rows.length > limit && last !== undefined ? cursorOf(last) : null };
}

/** Keyset condition for rows ordered `created_at desc, id desc` after the cursor row. */
function afterCreatedAt(cursor: Record<string, unknown> | null | undefined): string | null {
  const createdAt = cursor?.['createdAt'];
  const id = cursor?.['id'];
  if (typeof createdAt !== 'string' || typeof id !== 'string') return null;
  return `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`;
}

const statusOfAccount = (account: UserRow['user_account']): string =>
  (Array.isArray(account) ? account[0]?.status : account?.status) ?? 'active';

/** FR-ADMIN-019 / FR-ADMIN-020 — staff search of members, posts and the audit trail. */
export class SupabaseAdminContentRepository implements IAdminContentRepository {
  constructor(private readonly client: Client) {}

  async findActiveMembers(text: string, limit: number): Promise<readonly AdminMemberRef[]> {
    return guarded(async () => {
      // Plain `users` read (active members are readable to any signed-in viewer); no staff join.
      const rows = unwrapCall(
        'table:users',
        await this.client
          .from('users')
          .select('id, display_name')
          .eq('is_active', true)
          .ilike('display_name', likePattern(text))
          .limit(limit),
      );
      return (rows ?? []).map((r) => ({ userId: r.id, displayName: r.display_name }));
    });
  }

  async searchUsers(filters: AdminUserSearchFilters): Promise<AdminSearchPage<AdminUserSearchResult>> {
    return guarded(async () => {
      const limit = filters.limit ?? DEFAULT_LIMIT;
      // `users_select_staff` + `user_account_select_staff`: members in every account state.
      // `search_users_page` is not used: it returns active members only and needs two letters.
      let query = this.client
        .from('users')
        .select('id, display_name, share_handle, city_id, created_at, user_account!inner(status)')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);
      if (filters.status) query = query.eq('user_account.status', filters.status);
      if (filters.query) {
        const pattern = likePattern(filters.query);
        query = query.or(`display_name.ilike.${pattern},share_handle.ilike.${pattern}`);
      }
      const after = afterCreatedAt(filters.cursor);
      if (after) query = query.or(after);
      const rows = (unwrapCall('table:users', await query) ?? []) as unknown as UserRow[];
      const page = pageOf(rows, limit, (r) => ({ createdAt: r.created_at, id: r.id }));
      return {
        rows: page.rows.map((r) => ({
          userId: r.id,
          displayName: r.display_name,
          shareHandle: r.share_handle,
          accountStatus: statusOfAccount(r.user_account),
          cityId: r.city_id,
          createdAt: new Date(r.created_at),
        })),
        nextCursor: page.nextCursor,
      };
    });
  }

  async searchPosts(filters: AdminPostSearchFilters): Promise<AdminSearchPage<AdminPostSearchResult>> {
    return guarded(async () => {
      const limit = filters.limit ?? DEFAULT_LIMIT;
      // `posts_select_staff`: posts in every status and audience, removed ones included.
      let query = this.client
        .from('posts')
        .select('id, title, post_type, status, visibility, owner_id, created_at, updated_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.query) {
        const pattern = likePattern(filters.query);
        query = query.or(`title.ilike.${pattern},description.ilike.${pattern}`);
      }
      const after = afterCreatedAt(filters.cursor);
      if (after) query = query.or(after);
      const rows = unwrapCall('table:posts', await query) ?? [];
      const page = pageOf(rows, limit, (r) => ({ createdAt: r.created_at, id: r.id }));
      const owners = await loadDisplayNames(this.client, page.rows.map((r) => r.owner_id));
      return {
        rows: page.rows.map((r) => ({
          postId: r.id,
          title: r.title,
          type: r.post_type,
          status: r.status,
          visibility: r.visibility,
          ownerId: r.owner_id,
          ownerDisplayName: owners.get(r.owner_id) ?? null,
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
        })),
        nextCursor: page.nextCursor,
      };
    });
  }

  async searchAudit(filters: AdminAuditSearchFilters): Promise<AdminSearchPage<AdminAuditRow>> {
    return guarded(async () => {
      const limit = Math.min(filters.limit ?? 100, AUDIT_MAX_LIMIT);
      const before = filters.cursor;
      const rows = await callAuditSearch(this.client, {
        p_limit: limit + 1,
        ...(filters.targetUserId ? { p_target_id: filters.targetUserId } : {}),
        ...(filters.actorId ? { p_actor_id: filters.actorId } : {}),
        ...(filters.action ? { p_action: filters.action } : {}),
        ...(filters.fromDate ? { p_from: filters.fromDate.toISOString() } : {}),
        ...(filters.toDate ? { p_to: filters.toDate.toISOString() } : {}),
        ...(typeof before?.['occurredAt'] === 'string' && typeof before['id'] === 'number'
          ? { p_before_occurred_at: before['occurredAt'], p_before_id: before['id'] }
          : {}),
      });
      const page = pageOf(rows, limit, (r) => ({ occurredAt: r.occurred_at, id: r.id }));
      // The audit trail carries ids only (FR-ADMIN-007): the names come from `users`.
      const named = page.rows.flatMap((r) => [
        ...(r.actor_id ? [r.actor_id] : []),
        ...(r.target_type === 'user' && r.target_id ? [r.target_id] : []),
      ]);
      const names = await loadDisplayNames(this.client, named);
      return {
        rows: page.rows.map((r) => ({
          eventId: String(r.id),
          actorId: r.actor_id ?? null,
          actorDisplayName: r.actor_id ? names.get(r.actor_id) ?? null : null,
          action: r.action,
          targetType: r.target_type ?? null,
          targetId: r.target_id ?? null,
          targetDisplayName: r.target_type === 'user' && r.target_id ? names.get(r.target_id) ?? null : null,
          metadata: (r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)
            ? r.metadata
            : {}) as Record<string, unknown>,
          createdAt: new Date(r.occurred_at),
        })),
        nextCursor: page.nextCursor,
      };
    });
  }
}
