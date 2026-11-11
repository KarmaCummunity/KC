// "Show my active status" (0419). Owner-only flag read/written through RPCs; Realtime
// Authorization enforces it for presence (no track, no receive when off).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.legacy.types';

export class SupabaseActiveStatusRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** Defaults to true (column default) when the row/flag is missing. */
  async get(): Promise<boolean> {
    const { data, error } = await this.client.rpc('rpc_get_show_active_status');
    if (error) throw new Error(`getShowActiveStatus: ${error.message}`);
    return data !== false;
  }

  async set(enabled: boolean): Promise<boolean> {
    const { data, error } = await this.client.rpc('rpc_set_show_active_status', { p_enabled: enabled });
    if (error) throw new Error(`setShowActiveStatus: ${error.message}`);
    return data !== false;
  }
}
