import { buildKcSupportOptions, type KcSupportOptions } from '@kc/domain';
import type { IKcSupportChannelsRepository } from '../ports/IKcSupportChannelsRepository';

/**
 * FR-DONATE-011 — resolves how a donor can support KC directly.
 *
 * The server-configured channels are the single source of truth (D20: the
 * provider is swappable without a release; D64: interim links are withdrawn
 * once clearing exists), so there is deliberately no compiled fallback — a
 * load failure propagates as `KcSupportChannelsError` and the UI shows the
 * "unavailable" state instead of possibly stale payment links.
 */
export class GetKcSupportOptionsUseCase {
  constructor(private readonly repo: IKcSupportChannelsRepository) {}

  async execute(): Promise<KcSupportOptions> {
    return buildKcSupportOptions(await this.repo.listActiveChannels());
  }
}
