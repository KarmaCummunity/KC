import type { SupabaseClient } from '@supabase/supabase-js';
import type { GuestPost, IGuestPostsRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { mapGuestPostRow } from './mapGuestPostRow';

type Row = Database['public']['Functions']['guest_posts']['Returns'][number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guest screens never hydrate member cards, storage or comments. */
export class SupabaseGuestPostsRepository implements IGuestPostsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async list(beforeId?: string): Promise<readonly GuestPost[]> {
    if (beforeId && !UUID.test(beforeId)) return [];
    const rows = unwrapCall('rpc:guest_posts', await this.client.rpc('guest_posts', {
      p_limit: 20, ...(beforeId ? { p_before_id: beforeId } : {}),
    }));
    return (rows ?? []).map((row) => mapGuestPostRow(row as Row));
  }
  async get(id: string): Promise<GuestPost | null> {
    if (!UUID.test(id)) return null;
    const rows = unwrapCall('rpc:guest_posts', await this.client.rpc('guest_posts', { p_post_id: id, p_limit: 1 }));
    return rows?.[0] ? mapGuestPostRow(rows[0] as Row) : null;
  }
}
