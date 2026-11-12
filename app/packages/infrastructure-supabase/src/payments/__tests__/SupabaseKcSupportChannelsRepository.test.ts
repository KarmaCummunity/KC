// FR-DONATE-011: the KC support channels are read from `list_kc_support_channels` and mapped to
// the domain type; a backend that lacks the function still degrades instead of leaking an error.
import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { SupabaseKcSupportChannelsRepository } from '../SupabaseKcSupportChannelsRepository';

const ROWS = [
  { channel: 'bit', url: 'https://pay.example/bit', provider_label: 'Bit', payee_phone: '0501234567' },
  { channel: 'card_one_time', url: 'https://pay.example/card', provider_label: 'Grow', payee_phone: null },
  { channel: 'unknown_kind', url: 'https://pay.example/x', provider_label: 'X', payee_phone: null },
];

describe('SupabaseKcSupportChannelsRepository', () => {
  it('maps the rows and drops a channel kind the app does not know', async () => {
    const { client, calls } = createFakeClient({ rpc: { list_kc_support_channels: { data: ROWS, error: null } } });

    const channels = await new SupabaseKcSupportChannelsRepository(client).listActiveChannels();

    expect(callsTo(calls, 'list_kc_support_channels')).toHaveLength(1);
    expect(channels).toEqual([
      { kind: 'bit', url: 'https://pay.example/bit', providerLabel: 'Bit', payeePhone: '0501234567' },
      { kind: 'card_one_time', url: 'https://pay.example/card', providerLabel: 'Grow', payeePhone: null },
    ]);
  });

  it('is empty when the table has no active channel', async () => {
    const { client } = createFakeClient({ rpc: { list_kc_support_channels: { data: null, error: null } } });
    await expect(new SupabaseKcSupportChannelsRepository(client).listActiveChannels()).resolves.toEqual([]);
  });

  it('reports a backend without the function as unavailable', async () => {
    const { client } = createFakeClient({
      rpc: { list_kc_support_channels: { data: null, error: { code: 'PGRST202', message: 'not found' } } },
    });
    await expect(new SupabaseKcSupportChannelsRepository(client).listActiveChannels()).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});
