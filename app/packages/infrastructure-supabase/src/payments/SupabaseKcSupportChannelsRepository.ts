import { BackendUnavailableError, type KcSupportChannel } from '@kc/domain';
import type { IKcSupportChannelsRepository } from '@kc/application';

/**
 * FR-DONATE-011 — the channels for supporting KC directly. The production baseline has no
 * support-channel list yet (docs/db/app-migration-map.md M20; the money world opens behind
 * `world_money_enabled`), so the read rejects with `BackendUnavailableError` without calling the
 * backend, and the support card shows its unavailable state instead of payment links (degrade
 * rule, docs/db/app-migration-playbook.md § 3).
 */
export class SupabaseKcSupportChannelsRepository implements IKcSupportChannelsRepository {
  listActiveChannels(): Promise<KcSupportChannel[]> {
    return Promise.reject(new BackendUnavailableError('rpc:list_kc_support_channels', 'function'));
  }
}
