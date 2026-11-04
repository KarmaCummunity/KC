import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { KcSupportChannelsError } from '@kc/application';
import { SupabaseKcSupportChannelsRepository } from '../SupabaseKcSupportChannelsRepository';

type Result = { data: unknown; error: unknown };

/** Minimal fake of `rpc(fn)` that records which function was called. */
function makeRepo(result: Result) {
  const calls: string[] = [];
  const client = {
    rpc: async (fn: string) => {
      calls.push(fn);
      return result;
    },
  } as unknown as SupabaseClient;
  return { repo: new SupabaseKcSupportChannelsRepository(client as never), calls };
}

describe('SupabaseKcSupportChannelsRepository', () => {
  it('reads channels through list_kc_support_channels and maps them to domain channels', async () => {
    const { repo, calls } = makeRepo({
      data: [
        { channel: 'bit', url: 'https://bit.example/pay', provider_label: 'Bit', payee_phone: '0500000000' },
        { channel: 'card_standing_order', url: 'https://pay.grow.link/m', provider_label: 'Grow', payee_phone: null },
      ],
      error: null,
    });
    expect(await repo.listActiveChannels()).toEqual([
      { kind: 'bit', url: 'https://bit.example/pay', providerLabel: 'Bit', payeePhone: '0500000000' },
      { kind: 'card_standing_order', url: 'https://pay.grow.link/m', providerLabel: 'Grow', payeePhone: null },
    ]);
    expect(calls).toEqual(['list_kc_support_channels']);
  });

  it('treats a missing payee phone (guest masking) as null', async () => {
    const { repo } = makeRepo({
      data: [{ channel: 'paybox', url: 'https://links.payboxapp.com/x', provider_label: 'PayBox' }],
      error: null,
    });
    expect((await repo.listActiveChannels())[0]?.payeePhone).toBeNull();
  });

  it('drops rows with an unknown channel kind', async () => {
    const { repo } = makeRepo({
      data: [{ channel: 'bank_transfer', url: 'https://bank.example', provider_label: 'Bank', payee_phone: null }],
      error: null,
    });
    expect(await repo.listActiveChannels()).toEqual([]);
  });

  it('throws KcSupportChannelsError on an RPC error', async () => {
    const { repo } = makeRepo({ data: null, error: { message: 'boom' } });
    await expect(repo.listActiveChannels()).rejects.toBeInstanceOf(KcSupportChannelsError);
  });
});
