// ─────────────────────────────────────────────
// SupabaseDeviceRepository — adapter for IDeviceRepository.
// Mapped to spec: FR-NOTIF-015. Table `public.user_devices` of the production baseline:
// one row per push token, owner-only; a dead token is deleted, never deactivated.
// ─────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Device, DeviceRegistration } from '@kc/domain';
import type { IDeviceRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

const COLUMNS = 'id, user_id, push_token, platform, last_seen_at';

type DeviceRow = Pick<
  Database['public']['Tables']['user_devices']['Row'],
  'id' | 'user_id' | 'push_token' | 'platform' | 'last_seen_at'
>;

/** PostgREST `PGRST116`: no row matched — deactivating an unknown token is a no-op. */
const NO_ROWS = 'PGRST116';

function mapRow(row: DeviceRow): Device {
  return {
    deviceId: row.id,
    userId: row.user_id,
    pushToken: row.push_token,
    platform: row.platform as 'ios' | 'android' | 'web',
    lastSeenAt: row.last_seen_at,
    active: true,
  };
}

export class SupabaseDeviceRepository implements IDeviceRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async upsert(input: DeviceRegistration): Promise<Device> {
    const row = unwrapCall(
      'table:user_devices',
      await this.client
        .from('user_devices')
        .upsert(
          {
            user_id: input.userId,
            push_token: input.pushToken,
            platform: input.platform,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: 'push_token' },
        )
        .select(COLUMNS)
        .single(),
    );
    if (!row) throw new Error('upsert device: no row returned');
    return mapRow(row);
  }

  async deactivate(pushToken: string): Promise<void> {
    const { error } = await this.client.from('user_devices').delete().eq('push_token', pushToken);
    if (error && error.code !== NO_ROWS) unwrapCall('table:user_devices', { data: null, error });
  }

  async listForUser(userId: string): Promise<Device[]> {
    const rows = unwrapCall(
      'table:user_devices',
      await this.client.from('user_devices').select(COLUMNS).eq('user_id', userId),
    );
    return (rows ?? []).map(mapRow);
  }
}
