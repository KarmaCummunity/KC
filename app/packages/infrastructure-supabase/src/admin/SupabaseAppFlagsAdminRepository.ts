// #2277 (FR-ADMIN-034): the super admin's write of a feature flag. `admin_set_app_flag` checks the
// role (42501 for anyone else), validates the key and audits the change, so this adapter only
// makes the call and maps its failure with the shared RPC error mapping.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IAppFlagsAdminRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

export class SupabaseAppFlagsAdminRepository implements IAppFlagsAdminRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async setFlag(key: string, enabled: boolean): Promise<void> {
    unwrapCall('rpc:admin_set_app_flag', await this.client.rpc('admin_set_app_flag', { p_key: key, p_enabled: enabled }));
  }
}
