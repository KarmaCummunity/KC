// FR-DONATE-011: the KC support channels come from list_kc_support_channels (migration 0019).
import { describe, expect, it } from 'vitest';
import { KcSupportChannelsError } from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { SupabaseKcSupportChannelsRepository } from '../SupabaseKcSupportChannelsRepository';

describe('SupabaseKcSupportChannelsRepository', () => {
  it('maps the active channels and drops a kind this build does not know', async () => {
    const { client, calls } = createFakeClient({
      rpc: {
        list_kc_support_channels: {
          data: [
            { channel: 'bit', url: 'https://bit.test/kc', provider_label: 'Bit', payee_phone: '0501234567' },
            { channel: 'crypto', url: 'https://x.test', provider_label: 'X', payee_phone: null },
          ],
          error: null,
        },
      },
    });

    await expect(new SupabaseKcSupportChannelsRepository(client).listActiveChannels()).resolves.toEqual([
      { kind: 'bit', url: 'https://bit.test/kc', providerLabel: 'Bit', payeePhone: '0501234567' },
    ]);
    expect(calls.map((c) => c.fn)).toEqual(['list_kc_support_channels']);
  });

  it('keeps a missing function as BackendUnavailableError and wraps any other failure', async () => {
    const missing = createFakeClient({
      rpc: { list_kc_support_channels: { data: null, error: { code: 'PGRST202', message: 'not in the schema cache' } } },
    });
    const down = createFakeClient({
      rpc: { list_kc_support_channels: { data: null, error: { code: '57014', message: 'timeout' } } },
    });

    await expect(new SupabaseKcSupportChannelsRepository(missing.client).listActiveChannels())
      .rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(new SupabaseKcSupportChannelsRepository(down.client).listActiveChannels())
      .rejects.toBeInstanceOf(KcSupportChannelsError);
  });
});
