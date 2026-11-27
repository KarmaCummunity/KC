import type { SupabaseClient } from '@supabase/supabase-js';
import { BackendUnavailableError } from '@kc/domain';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../database.types';
import { SupabaseKarmaHistoryRepository } from '../SupabaseKarmaHistoryRepository';

/** A client whose query chain records its calls and resolves with `result` at `limit`. */
function clientAnswering(result: unknown) {
  const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);
  const from = vi.fn(() => chain);
  return { client: { from } as unknown as SupabaseClient<Database>, from, chain };
}

describe('SupabaseKarmaHistoryRepository', () => {
  it("reads the member's ledger newest first, with a stable order inside one moment", async () => {
    const { client, from, chain } = clientAnswering({ data: [], error: null });

    await new SupabaseKarmaHistoryRepository(client).listHistory('u1', 300);

    expect(from).toHaveBeenCalledWith('karma_ledger');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(chain.order.mock.calls).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(chain.limit).toHaveBeenCalledWith(300);
  });

  it('maps ledger rows to history entries', async () => {
    const { client } = clientAnswering({
      data: [{ id: 7, event_type: 'reversal', points: -20, created_at: '2026-11-01T10:00:00Z' }],
      error: null,
    });

    const entries = await new SupabaseKarmaHistoryRepository(client).listHistory('u1', 10);

    expect(entries).toEqual([{ id: 7, eventType: 'reversal', delta: -20, createdAt: '2026-11-01T10:00:00Z' }]);
  });

  it('is an empty history when the member has no entry', async () => {
    const { client } = clientAnswering({ data: null, error: null });

    expect(await new SupabaseKarmaHistoryRepository(client).listHistory('u1', 10)).toEqual([]);
  });

  it('reports a missing ledger table as an unavailable backend, and any other failure as an error', async () => {
    const missing = clientAnswering({ data: null, error: { code: 'PGRST205', message: 'not in the schema cache' } });
    const offline = clientAnswering({ data: null, error: { message: 'offline' } });

    await expect(new SupabaseKarmaHistoryRepository(missing.client).listHistory('u1', 10)).rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(new SupabaseKarmaHistoryRepository(offline.client).listHistory('u1', 10)).rejects.toThrow('offline');
  });
});
