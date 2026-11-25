import type { SupabaseClient } from '@supabase/supabase-js';
import type { GuestMapBounds, GuestMapPin, IGuestMapRepository } from '@kc/application';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type Row = Database['public']['Functions']['guest_map_post_pins']['Returns'][number];

const map = (row: Row): GuestMapPin => ({
  postId: row.post_id,
  lat: row.lat,
  lng: row.lng,
  worldSlug: row.world_slug,
  direction: row.direction,
});

/** Guest map pins via `guest_map_post_pins` (anon only; ~1 km snapped). */
export class SupabaseGuestMapRepository implements IGuestMapRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listPins(
    bounds: GuestMapBounds,
    filters: Readonly<Record<string, unknown>> = {},
    limit = 100,
  ): Promise<readonly GuestMapPin[]> {
    const rows = unwrapCall(
      'rpc:guest_map_post_pins',
      await this.client.rpc('guest_map_post_pins', {
        p_bounds: bounds as unknown as Json,
        p_filters: filters as unknown as Json,
        p_limit: limit,
      }),
    );
    return (rows ?? []).map(map);
  }
}
