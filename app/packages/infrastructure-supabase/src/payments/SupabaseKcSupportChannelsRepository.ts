import type { SupabaseClient } from '@supabase/supabase-js';
import { isKcSupportChannelKind, type KcSupportChannel } from '@kc/domain';
import type { IKcSupportChannelsRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

/**
 * FR-DONATE-011 — the channels for supporting KC directly, read from `list_kc_support_channels`
 * (migration 0019). The function returns only active channels and masks the payee phone for
 * guests. A backend that lacks the function still degrades: `unwrapCall` maps the missing object
 * to `BackendUnavailableError` and the support card shows its unavailable state.
 */
export class SupabaseKcSupportChannelsRepository implements IKcSupportChannelsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listActiveChannels(): Promise<KcSupportChannel[]> {
    const rows = unwrapCall('rpc:list_kc_support_channels', await this.client.rpc('list_kc_support_channels'));
    return (rows ?? []).flatMap((row) =>
      // A kind added on the server before the app knows it is skipped, never shown half-formed.
      isKcSupportChannelKind(row.channel)
        ? [{ kind: row.channel, url: row.url, providerLabel: row.provider_label, payeePhone: row.payee_phone }]
        : [],
    );
  }
}
