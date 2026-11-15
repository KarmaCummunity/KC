import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IModerationQueueRepository, ModerationQueueCursor, ModerationQueueEntry, ModerationQueuePage,
  ModerationQueueReason, ModerationQueueTargetType,
} from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall, type CallResult } from '../rpc/mapRpcError';
import { toModerationError } from './SupabaseModerationAdminRepository';

type Client = SupabaseClient<Database>;

const TARGET_TYPES: readonly string[] = ['post', 'user', 'comment', 'chat'];
const REASONS: readonly string[] = [
  'report_threshold', 'excessive_reopens', 'forbidden_keyword', 'manual_flag', 'operator_case',
];

async function call<T>(object: string, pending: PromiseLike<CallResult<T>>): Promise<T> {
  try {
    return unwrapCall(object, await pending);
  } catch (error) {
    throw toModerationError(error);
  }
}

/**
 * FR-MOD-008 — the staff review queue: a direct read of `moderation_queue` under
 * `moderation_queue_select_staff` (open entries, oldest first, keyset paged) and the two
 * baseline writes `admin_assign_queue_entry` / `admin_resolve_queue_entry`.
 */
export class SupabaseModerationQueueRepository implements IModerationQueueRepository {
  constructor(private readonly client: Client) {}

  async listOpen(cursor: ModerationQueueCursor | null, limit: number): Promise<ModerationQueuePage> {
    let query = this.client
      .from('moderation_queue')
      .select('id, target_type, target_id, reason, assignee_id, metadata, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);
    if (cursor) {
      query = query.or(
        `created_at.gt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.gt.${cursor.entryId})`,
      );
    }
    const rows = await call('table:moderation_queue', query) ?? [];
    const entries: ModerationQueueEntry[] = rows
      .filter((row) => TARGET_TYPES.includes(row.target_type) && REASONS.includes(row.reason))
      .map((row) => ({
        entryId: row.id,
        targetType: row.target_type as ModerationQueueTargetType,
        targetId: row.target_id,
        reason: row.reason as ModerationQueueReason,
        assigneeId: row.assignee_id ?? null,
        metadata: (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? row.metadata : {}) as Record<string, unknown>,
        createdAt: row.created_at,
      }));
    const last = rows[rows.length - 1];
    return {
      entries,
      nextCursor: rows.length === limit && last ? { createdAt: last.created_at, entryId: last.id } : null,
    };
  }

  async assign(entryId: string, assigneeId?: string): Promise<void> {
    await call('rpc:admin_assign_queue_entry', this.client.rpc('admin_assign_queue_entry', {
      p_entry_id: entryId,
      ...(assigneeId ? { p_assignee_id: assigneeId } : {}),
    }));
  }

  async resolve(entryId: string): Promise<void> {
    await call('rpc:admin_resolve_queue_entry', this.client.rpc('admin_resolve_queue_entry', { p_entry_id: entryId }));
  }
}
