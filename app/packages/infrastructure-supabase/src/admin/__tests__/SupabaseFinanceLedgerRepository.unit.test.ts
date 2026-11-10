import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isFinanceLedgerError } from '@kc/domain';
import { SupabaseFinanceLedgerRepository } from '../SupabaseFinanceLedgerRepository';

function mockClient(rpcImpl: (name: string, args?: unknown) => unknown): SupabaseClient {
  return { rpc: vi.fn(rpcImpl as never) } as unknown as SupabaseClient;
}

const validRow = {
  entry_id:     'e1',
  kind:         'donation_in',
  direction:    'in',
  amount_cents: 1000,
  currency:     'ILS',
  occurred_at:  '2026-01-01T00:00:00.000Z',
  counterparty: 'Donor',
  category:     null,
  description:  null,
  reference_url: null,
  status:       'cleared',
  created_at:   '2026-01-01T00:00:00.000Z',
  updated_at:   '2026-01-01T00:00:00.000Z',
  total_count:  1,
};

describe('SupabaseFinanceLedgerRepository — list', () => {
  it('maps a row, parses amount + dates, and forwards filters', async () => {
    const spy = vi.fn(() => ({ data: [validRow], error: null }));
    const repo = new SupabaseFinanceLedgerRepository(mockClient(spy as never));
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to   = new Date('2026-01-31T23:59:59.999Z');
    const page = await repo.list({
      direction: 'in', kind: 'donation_in', status: 'cleared',
      fromDate: from, toDate: to, limit: 10, offset: 5,
    });
    expect(spy).toHaveBeenCalledWith('finance_ledger_list', {
      p_direction: 'in',
      p_kind:      'donation_in',
      p_status:    'cleared',
      p_from:      from.toISOString(),
      p_to:        to.toISOString(),
      p_limit:     10,
      p_offset:    5,
    });
    expect(page.totalCount).toBe(1);
    expect(page.rows[0]?.entryId).toBe('e1');
    expect(page.rows[0]?.amountCents).toBe(1000);
    expect(page.rows[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it('drops rows with an unparseable kind/status/direction', async () => {
    const repo = new SupabaseFinanceLedgerRepository(
      mockClient(() => ({ data: [{ ...validRow, direction: 'sideways' }], error: null })),
    );
    expect((await repo.list({})).rows).toEqual([]);
  });

  it('parses string amount_cents and total_count', async () => {
    const repo = new SupabaseFinanceLedgerRepository(
      mockClient(() => ({ data: [{ ...validRow, amount_cents: '2500', total_count: '7' }], error: null })),
    );
    const page = await repo.list({});
    expect(page.rows[0]?.amountCents).toBe(2500);
    expect(page.totalCount).toBe(7);
  });

  it('returns an empty page when data is null', async () => {
    const repo = new SupabaseFinanceLedgerRepository(
      mockClient(() => ({ data: null, error: null })),
    );
    expect(await repo.list({})).toEqual({ rows: [], totalCount: 0 });
  });

  it('maps SQLSTATE 42501 to forbidden', async () => {
    const repo = new SupabaseFinanceLedgerRepository(
      mockClient(() => ({ data: null, error: { code: '42501', message: 'denied' } })),
    );
    await expect(repo.list({})).rejects.toSatisfy((e) =>
      isFinanceLedgerError(e) && e.code === 'forbidden',
    );
  });

  it('maps known error messages to domain codes', async () => {
    const repo = new SupabaseFinanceLedgerRepository(
      mockClient(() => ({ data: null, error: { message: 'invalid_amount' } })),
    );
    await expect(repo.list({})).rejects.toSatisfy((e) =>
      isFinanceLedgerError(e) && e.code === 'invalid_amount',
    );
  });
});

describe('SupabaseFinanceLedgerRepository — summary / upsert / delete', () => {
  it('summary forwards date range and parses cents', async () => {
    const spy = vi.fn(() => ({
      data: [{ currency: 'ILS', income_cents: '1000', expense_cents: 200, net_cents: '800', entry_count: 3 }],
      error: null,
    }));
    const repo = new SupabaseFinanceLedgerRepository(mockClient(spy as never));
    const from = new Date('2026-01-01T00:00:00.000Z');
    const out = await repo.summary(from, undefined);
    expect(spy).toHaveBeenCalledWith('finance_ledger_summary', {
      p_from: from.toISOString(),
      p_to:   null,
    });
    expect(out[0]).toMatchObject({ currency: 'ILS', incomeCents: 1000, expenseCents: 200, netCents: 800, entryCount: 3 });
  });

  it('summary returns empty when data is not an array', async () => {
    const repo = new SupabaseFinanceLedgerRepository(
      mockClient(() => ({ data: null, error: null })),
    );
    expect(await repo.summary()).toEqual([]);
  });

  it('upsert forwards args and returns the id', async () => {
    const spy = vi.fn(() => ({ data: 'new-id', error: null }));
    const repo = new SupabaseFinanceLedgerRepository(mockClient(spy as never));
    const id = await repo.upsert({ kind: 'expense', amountCents: 500, currency: 'ILS' } as never);
    expect(id).toBe('new-id');
    expect(spy).toHaveBeenCalledWith('finance_ledger_upsert', expect.objectContaining({
      p_entry_id: null,
      p_kind:     'expense',
      p_amount_cents: 500,
      p_currency: 'ILS',
    }));
  });

  it('upsert maps entry_not_found from P0002 code', async () => {
    const repo = new SupabaseFinanceLedgerRepository(
      mockClient(() => ({ data: null, error: { code: 'P0002', message: 'gone' } })),
    );
    await expect(repo.upsert({ entryId: 'x' } as never)).rejects.toSatisfy((e) =>
      isFinanceLedgerError(e) && e.code === 'entry_not_found',
    );
  });

  it('upsert throws unknown when data is not a string', async () => {
    const repo = new SupabaseFinanceLedgerRepository(
      mockClient(() => ({ data: null, error: null })),
    );
    await expect(repo.upsert({ kind: 'expense' } as never)).rejects.toSatisfy((e) =>
      isFinanceLedgerError(e) && e.code === 'unknown',
    );
  });

  it('delete forwards the id', async () => {
    const spy = vi.fn(() => ({ data: null, error: null }));
    const repo = new SupabaseFinanceLedgerRepository(mockClient(spy as never));
    await repo.delete('e1');
    expect(spy).toHaveBeenCalledWith('finance_ledger_delete', { p_entry_id: 'e1' });
  });

  it('delete falls back to unknown for unmapped errors', async () => {
    const repo = new SupabaseFinanceLedgerRepository(
      mockClient(() => ({ data: null, error: { message: 'boom' } })),
    );
    await expect(repo.delete('e2')).rejects.toSatisfy((e) =>
      isFinanceLedgerError(e) && e.code === 'unknown',
    );
  });
});

describe('SupabaseFinanceLedgerRepository — account_id / is_public (0470)', () => {
  it('maps the new columns', async () => {
    const repo = new SupabaseFinanceLedgerRepository(mockClient(() => ({
      data: [{ ...validRow, account_id: 'acc-1', is_public: false }], error: null,
    })));
    const row = (await repo.list({})).rows[0];
    expect(row?.accountId).toBe('acc-1');
    expect(row?.isPublic).toBe(false);
  });

  it('falls back to legacy-safe defaults when an older server omits them', async () => {
    const repo = new SupabaseFinanceLedgerRepository(mockClient(() => ({ data: [validRow], error: null })));
    const row = (await repo.list({})).rows[0];
    expect(row?.accountId).toBeNull();
    expect(row?.isPublic).toBe(true);
  });

  it('upsert forwards accountId and isPublic (null = keep)', async () => {
    const spy = vi.fn(() => ({ data: 'id', error: null }));
    const repo = new SupabaseFinanceLedgerRepository(mockClient(spy as never));
    await repo.upsert({ kind: 'expense', amountCents: 1, accountId: 'acc-1', isPublic: false } as never);
    expect(spy).toHaveBeenLastCalledWith('finance_ledger_upsert', expect.objectContaining({
      p_account_id: 'acc-1', p_is_public: false,
    }));
    await repo.upsert({ entryId: 'e1' } as never);
    expect(spy).toHaveBeenLastCalledWith('finance_ledger_upsert', expect.objectContaining({
      p_account_id: null, p_is_public: null,
    }));
  });
});
