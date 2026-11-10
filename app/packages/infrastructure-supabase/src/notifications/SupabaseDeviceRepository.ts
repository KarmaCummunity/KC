// ─────────────────────────────────────────────
// SupabaseDeviceRepository — adapter for IDeviceRepository.
// Mapped to spec: FR-NOTIF-015. Table `public.user_devices` of the production baseline:
// one row per push token, owner-only; a dead token is deleted, never deactivated.
// ─────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Device, DeviceRegistration } from '@kc/domain';
import type { IDeviceRepository } from '@kc/application';
import type { Database } from '../database.types';

interface DeviceRow {
  id: string;
  user_id: string;
  push_token: string;
  platform: string;
  last_seen_at: string;
}

const TABLE = 'user_devices' as never;
const COLUMNS = 'id, user_id, push_token, platform, last_seen_at';

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
    const { data, error } = await this.client
      .from(TABLE)
      .upsert(
        {
          user_id: input.userId,
          push_token: input.pushToken,
          platform: input.platform,
          last_seen_at: new Date().toISOString(),
        } as never,
        { onConflict: 'push_token' },
      )
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return mapRow(data as unknown as DeviceRow);
  }

  async deactivate(pushToken: string): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .delete()
      .eq('push_token', pushToken);
    if (error && error.code !== 'PGRST116') throw error;
  }

  async listForUser(userId: string): Promise<Device[]> {
    const { data, error } = await this.client
      .from(TABLE)
      .select(COLUMNS)
      .eq('user_id', userId);
    if (error) throw error;
    return ((data ?? []) as unknown as DeviceRow[]).map(mapRow);
  }
}
