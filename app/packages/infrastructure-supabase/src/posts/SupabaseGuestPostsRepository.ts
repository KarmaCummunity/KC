import type { SupabaseClient } from '@supabase/supabase-js';
import type { GuestPost, IGuestPostsRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type Row = Database['public']['Functions']['guest_posts']['Returns'][number];
const map = (row: Row): GuestPost => ({
  id: row.id, title: row.title, description: row.description,
  cityNameHe: row.city_name_he, cityNameEn: row.city_name_en,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guest screens never hydrate member cards, authors, storage or comments. */
export class SupabaseGuestPostsRepository implements IGuestPostsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async list(beforeId?: string): Promise<readonly GuestPost[]> {
    if (beforeId && !UUID.test(beforeId)) return [];
    const rows = unwrapCall('rpc:guest_posts', await this.client.rpc('guest_posts', {
      p_limit: 20, ...(beforeId ? { p_before_id: beforeId } : {}),
    }));
    return (rows ?? []).map(map);
  }
  async get(id: string): Promise<GuestPost | null> {
    if (!UUID.test(id)) return null;
    const rows = unwrapCall('rpc:guest_posts', await this.client.rpc('guest_posts', { p_post_id: id, p_limit: 1 }));
    return rows?.[0] ? map(rows[0]) : null;
  }
}
