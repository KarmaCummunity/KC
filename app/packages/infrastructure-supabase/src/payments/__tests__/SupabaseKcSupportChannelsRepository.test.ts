// FR-DONATE-011: the KC support channels are not in the baseline yet (M20), so the read degrades.
import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { SupabaseKcSupportChannelsRepository } from '../SupabaseKcSupportChannelsRepository';

describe('SupabaseKcSupportChannelsRepository', () => {
  it('reports the missing support-channel list', async () => {
    await expect(new SupabaseKcSupportChannelsRepository().listActiveChannels()).rejects.toMatchObject({
      object: 'rpc:list_kc_support_channels',
      kind: 'function',
    });
    await expect(new SupabaseKcSupportChannelsRepository().listActiveChannels()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
