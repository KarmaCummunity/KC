// Seats of event and ride posts as any reader of the post sees them (`post_seat_counts`): the
// places held, the waiting list and the seats left, without reading anyone's registration.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type Client = SupabaseClient<Database>;

export interface PostSeatCount {
  /** Places of an event or seats of a ride offer; null when unlimited or for a ride request. */
  readonly capacity: number | null;
  readonly taken: number;
  readonly waitlisted: number;
  /** Null when the capacity is. */
  readonly left: number | null;
}

/** The seat counts of the readable posts among `postIds`, by post id; one call for the whole list. */
export async function loadSeatCounts(client: Client, postIds: readonly string[]): Promise<Map<string, PostSeatCount>> {
  if (postIds.length === 0) return new Map();
  const rows = unwrapCall('rpc:post_seat_counts', await client.rpc('post_seat_counts', { p_post_ids: [...postIds] }));
  return new Map(
    (rows ?? []).map((row) => [
      row.post_id,
      { capacity: row.capacity, taken: row.seats_taken, waitlisted: row.waitlisted, left: row.seats_left },
    ]),
  );
}
