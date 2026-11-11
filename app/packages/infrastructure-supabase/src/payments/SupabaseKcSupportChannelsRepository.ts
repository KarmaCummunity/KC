import type { SupabaseClient } from '@supabase/supabase-js';
import { KcSupportChannelsError, type IKcSupportChannelsRepository } from '@kc/application';
import { isKcSupportChannelKind, type KcSupportChannel } from '@kc/domain';
import type { Database } from '../database.legacy.types';

type ChannelRow = Database['public']['Functions']['list_kc_support_channels']['Returns'][number];

/** Maps a row to a domain channel; rows with an unknown `channel` value are dropped. */
function mapRow(row: ChannelRow): KcSupportChannel | null {
  if (!isKcSupportChannelKind(row.channel)) return null;
  return {
    kind: row.channel,
    url: row.url,
    providerLabel: row.provider_label,
    // NULL for guests (masked server-side) and for channels without a payee phone.
    payeePhone: row.payee_phone ?? null,
  };
}

/**
 * Reads the active KC support channels through `list_kc_support_channels()`
 * (migration 0550) — FR-DONATE-011. The RPC returns active rows only and masks
 * the payee phone for guests, so the client never selects the phone column itself.
 */
export class SupabaseKcSupportChannelsRepository implements IKcSupportChannelsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listActiveChannels(): Promise<KcSupportChannel[]> {
    const { data, error } = await this.client.rpc('list_kc_support_channels');
    if (error) throw new KcSupportChannelsError('network', error.message, error);
    return (data ?? []).flatMap((row) => {
      const channel = mapRow(row);
      return channel ? [channel] : [];
    });
  }
}
