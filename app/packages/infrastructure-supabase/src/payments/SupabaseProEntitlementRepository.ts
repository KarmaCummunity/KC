// The caller's Pro entitlement, as the RevenueCat webhook recorded it (`api_my_pro_status`).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IProEntitlementRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

export class SupabaseProEntitlementRepository implements IProEntitlementRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async isPro(): Promise<boolean> {
    const status = unwrapCall('rpc:api_my_pro_status', await this.client.rpc('api_my_pro_status'));
    return (status as { is_pro?: boolean } | null)?.is_pro === true;
  }
}
