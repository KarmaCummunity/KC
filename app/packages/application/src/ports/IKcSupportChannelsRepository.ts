import type { KcSupportChannel } from '@kc/domain';

/** Read-only source of the hosted payment pages for supporting KC (FR-DONATE-011). */
export interface IKcSupportChannelsRepository {
  /** Active channels; throws `KcSupportChannelsError` when the source is unreachable. */
  listActiveChannels(): Promise<KcSupportChannel[]>;
}
