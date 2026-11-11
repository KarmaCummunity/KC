import type { SupabaseClient } from '@supabase/supabase-js';
import type { IRideSafetyRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

/**
 * Ride safety over `report_post_emergency` (docs/spec/05_giving_worlds.md §5.3 step 6, D70). The
 * server records the call, tells the others taking part and the safety team. A refusal keeps its
 * stable reason (`ride_not_active`, `emergency_throttled`, ...) for the screen.
 */
export class SupabaseRideSafetyRepository implements IRideSafetyRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async raiseEmergency(listingId: string, note: string | null): Promise<void> {
    unwrapCall(
      'rpc:report_post_emergency',
      await this.client.rpc('report_post_emergency', { p_post_id: listingId, p_note: note ?? undefined }),
    );
  }
}
