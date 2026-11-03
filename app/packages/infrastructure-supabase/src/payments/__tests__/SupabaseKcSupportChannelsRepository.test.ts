import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { KcSupportChannelsError } from '@kc/application';
import { SupabaseKcSupportChannelsRepository } from '../SupabaseKcSupportChannelsRepository';

type Result = { data: unknown; error: unknown };

/** Minimal fake of `from(table).select(cols).eq(col, value)` that records the query. */
function makeRepo(result: Result) {
  const query: { table?: string; columns?: string; filter?: [string, unknown] } = {};
  const client = {
    from: (table: string) => {
      query.table = table;
      return {
        select: (columns: string) => {
          query.columns = columns;
          return {
            eq: async (column: string, value: unknown) => {
              query.filter = [column, value];
              return result;
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { repo: new SupabaseKcSupportChannelsRepository(client as never), query };
}

describe('SupabaseKcSupportChannelsRepository', () => {
  it('reads active rows and maps them to domain channels', async () => {
    const { repo, query } = makeRepo({
      data: [
        { channel: 'bit', url: 'https://bit.example/pay', provider_label: 'Bit' },
        { channel: 'card_standing_order', url: 'https://pay.grow.link/m', provider_label: 'Grow' },
      ],
      error: null,
    });
    expect(await repo.listActiveChannels()).toEqual([
      { kind: 'bit', url: 'https://bit.example/pay', providerLabel: 'Bit' },
      { kind: 'card_standing_order', url: 'https://pay.grow.link/m', providerLabel: 'Grow' },
    ]);
    expect(query).toEqual({
      table: 'kc_support_channels',
      columns: 'channel, url, provider_label',
      filter: ['is_active', true],
    });
  });

  it('drops rows with an unknown channel kind', async () => {
    const { repo } = makeRepo({
      data: [{ channel: 'bank_transfer', url: 'https://bank.example', provider_label: 'Bank' }],
      error: null,
    });
    expect(await repo.listActiveChannels()).toEqual([]);
  });

  it('throws KcSupportChannelsError on a query error', async () => {
    const { repo } = makeRepo({ data: null, error: { message: 'boom' } });
    await expect(repo.listActiveChannels()).rejects.toBeInstanceOf(KcSupportChannelsError);
  });
});
