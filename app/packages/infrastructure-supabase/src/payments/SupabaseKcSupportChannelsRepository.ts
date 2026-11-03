import type { SupabaseClient } from '@supabase/supabase-js';
import { KcSupportChannelsError, type IKcSupportChannelsRepository } from '@kc/application';
import { isKcSupportChannelKind, type KcSupportChannel } from '@kc/domain';
import type { Database } from '../database.types';

type ChannelRow = Pick<
  Database['public']['Tables']['kc_support_channels']['Row'],
  'channel' | 'url' | 'provider_label'
>;

/** Maps a row to a domain channel; rows with an unknown `channel` value are dropped. */
function mapRow(row: ChannelRow): KcSupportChannel | null {
  if (!isKcSupportChannelKind(row.channel)) return null;
  return { kind: row.channel, url: row.url, providerLabel: row.provider_label };
}

/** Reads `public.kc_support_channels` (migration 0447) — FR-DONATE-011. */
export class SupabaseKcSupportChannelsRepository implements IKcSupportChannelsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listActiveChannels(): Promise<KcSupportChannel[]> {
    // Explicit `is_active` filter: RLS also exposes inactive rows to super admins,
    // who must see the same donor-facing options as everyone else.
    const { data, error } = await this.client
      .from('kc_support_channels')
      .select('channel, url, provider_label')
      .eq('is_active', true);
    if (error) throw new KcSupportChannelsError('network', error.message, error);
    return (data ?? []).flatMap((row) => {
      const channel = mapRow(row);
      return channel ? [channel] : [];
    });
  }
}
