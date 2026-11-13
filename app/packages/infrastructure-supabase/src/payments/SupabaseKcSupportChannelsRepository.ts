import type { SupabaseClient } from '@supabase/supabase-js';
import { KcSupportChannelsError, type IKcSupportChannelsRepository } from '@kc/application';
import { BackendUnavailableError, isKcSupportChannelKind, type KcSupportChannel } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type ChannelRow = Database['public']['Functions']['list_kc_support_channels']['Returns'][number];

/** Maps a row to a domain channel; a row with an unknown `channel` value is dropped. */
function mapRow(row: ChannelRow): KcSupportChannel | null {
  if (!isKcSupportChannelKind(row.channel)) return null;
  return {
    kind: row.channel,
    url: row.url,
    providerLabel: row.provider_label,
    // Null for guests (masked server-side) and for channels without a payee phone.
    payeePhone: row.payee_phone ?? null,
  };
}

/**
 * FR-DONATE-011 — the channels for supporting KC directly, read through
 * `list_kc_support_channels()` (migration 0019, a small table the super admin edits). The function
 * returns active rows only and masks the payee phone for guests, so the client never reads the
 * table itself. A backend without the function stays `BackendUnavailableError` (the card shows its
 * unavailable state); any other failure is a `KcSupportChannelsError('network')`.
 */
export class SupabaseKcSupportChannelsRepository implements IKcSupportChannelsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listActiveChannels(): Promise<KcSupportChannel[]> {
    let rows: ChannelRow[];
    try {
      rows = unwrapCall('rpc:list_kc_support_channels', await this.client.rpc('list_kc_support_channels')) ?? [];
    } catch (error) {
      if (error instanceof BackendUnavailableError) throw error;
      throw new KcSupportChannelsError('network', error instanceof Error ? error.message : 'unknown', error);
    }
    return rows.flatMap((row) => {
      const channel = mapRow(row);
      return channel ? [channel] : [];
    });
  }
}
