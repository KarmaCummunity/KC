// FR-KARMA-007: a member's own karma ledger (policy `karma_ledger_select_own`), newest first.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IKarmaHistoryRepository, KarmaHistoryEntry } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

export class SupabaseKarmaHistoryRepository implements IKarmaHistoryRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listHistory(userId: string, limit: number): Promise<KarmaHistoryEntry[]> {
    const rows = unwrapCall(
      'table:karma_ledger',
      await this.client
        .from('karma_ledger')
        .select('id, event_type, points, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        // Entries of one transaction share a timestamp; the id keeps their order stable.
        .order('id', { ascending: false })
        .limit(limit),
    );
    return (rows ?? []).map((row) => ({ id: row.id, eventType: row.event_type, delta: row.points, createdAt: row.created_at }));
  }
}
