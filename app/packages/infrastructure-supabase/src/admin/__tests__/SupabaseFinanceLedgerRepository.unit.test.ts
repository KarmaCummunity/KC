// V2-ADMIN-MONEY-9, FR-FIN-005, FR-FIN-014 — the ledger adapter on the org-scoped baseline RPCs.
import { describe, expect, it } from 'vitest';
import { BackendUnavailableError, FinanceLedgerError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeClientConfig } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseFinanceLedgerRepository, mapFinanceEntryRow } from '../SupabaseFinanceLedgerRepository';

const ORG = { organizations: ok({ id: 'kc-org' }) };
type EntryRow = Parameters<typeof mapFinanceEntryRow>[0];
const ROW: EntryRow = {
  id: 'e1', kind: 'donation_in', direction: 'in', amount_agorot: 12345, currency: 'ILS',
  occurred_at: '2030-01-02T10:00:00Z', account_id: 'a1', counterparty: 'Dana', category: 'donations',
  description: '', status: 'cleared', void_reason: '', is_public: true, source: 'manual', reconciled_at: '',
  created_at: '2030-01-02T10:00:00Z', updated_at: '2030-01-02T10:00:00Z',
};

const repoOf = (rpc: FakeClientConfig['rpc'], tables: FakeClientConfig['tables'] = ORG) => {
  const fake = createFakeClient({ rpc, tables });
  return { ...fake, repo: new SupabaseFinanceLedgerRepository(fake.client) };
};

describe('SupabaseFinanceLedgerRepository — list', () => {
  it('reads the platform organization books with the filters and maps the rows', async () => {
    const { repo, calls } = repoOf({ finance_ledger_list: ok([ROW]) });
    const page = await repo.list({ direction: 'in', status: 'cleared', limit: 10 });
    expect(page.rows[0]).toMatchObject({ entryId: 'e1', amountCents: 12345, accountId: 'a1', isPublic: true });
    expect(page.nextCursor).toBeNull();
    expect(callsTo(calls, 'organizations')[0]?.filters).toEqual([['eq', 'is_platform', true]]);
    expect(callsTo(calls, 'finance_ledger_list')[0]?.args).toMatchObject({
      p_org_id: 'kc-org', p_direction: 'in', p_status: 'cleared', p_limit: 10, p_after_id: undefined,
    });
  });

  it('gives a full page the cursor of its last row and pages after it', async () => {
    const { repo, calls } = repoOf({ finance_ledger_list: ok([ROW, { ...ROW, id: 'e2', occurred_at: '2030-01-01T00:00:00Z' }]) });
    const page = await repo.list({ limit: 2 });
    expect(page.nextCursor).toEqual({ occurredAt: new Date('2030-01-01T00:00:00Z'), entryId: 'e2' });
    await repo.list({ limit: 2, after: page.nextCursor! });
    expect(callsTo(calls, 'finance_ledger_list')[1]?.args).toMatchObject({
      p_after_occurred_at: '2030-01-01T00:00:00.000Z', p_after_id: 'e2',
    });
  });

  it('drops transfers and unknown kinds', () => {
    expect(mapFinanceEntryRow({ ...ROW, kind: 'transfer', direction: null as unknown as string })).toBeNull();
    expect(mapFinanceEntryRow({ ...ROW, kind: 'other_in' })).toBeNull();
  });

  it('maps refusals to finance codes and a missing function to unavailable', async () => {
    await expect(repoOf({ finance_ledger_list: fail('42501', 'forbidden') }).repo.list({})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(repoOf({ finance_ledger_list: fail('PGRST202', 'nope') }).repo.list({})).rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(repoOf({}, { organizations: ok(null) }).repo.list({})).rejects.toMatchObject({ code: 'org_not_found' });
  });
});

describe('SupabaseFinanceLedgerRepository — summary, upsert, void', () => {
  it('reads the period totals in agorot', async () => {
    const { repo, calls } = repoOf({ finance_ledger_summary: ok([
      { currency: 'ILS', income_agorot: 4500, expense_agorot: 300, net_agorot: 4200, entry_count: 7 },
    ]) });
    expect(await repo.summary(new Date('2030-01-01T00:00:00Z'))).toEqual([
      { currency: 'ILS', incomeCents: 4500, expenseCents: 300, netCents: 4200, entryCount: 7 },
    ]);
    expect(callsTo(calls, 'finance_ledger_summary')[0]?.args).toEqual({
      p_org_id: 'kc-org', p_from: '2030-01-01T00:00:00.000Z', p_to: undefined,
    });
  });

  it('writes an entry in agorot and returns its id', async () => {
    const { repo, calls } = repoOf({ finance_ledger_upsert: ok('e9') });
    await expect(repo.upsert({ kind: 'expense', amountCents: 2500, accountId: 'a1', isPublic: false, counterparty: null }))
      .resolves.toBe('e9');
    expect(callsTo(calls, 'finance_ledger_upsert')[0]?.args).toMatchObject({
      p_org_id: 'kc-org', p_kind: 'expense', p_amount_agorot: 2500, p_account_id: 'a1', p_is_public: false, p_counterparty: undefined,
    });
    await expect(repoOf({ finance_ledger_upsert: ok(null) }).repo.upsert({ kind: 'expense', amountCents: 1 }))
      .rejects.toBeInstanceOf(FinanceLedgerError);
  });

  it('voids an entry with the admin\'s reason instead of deleting it', async () => {
    const { repo, calls } = repoOf({ finance_ledger_mark: ok(null) });
    await repo.delete('e1', 'typed twice');
    expect(callsTo(calls, 'finance_ledger_mark')[0]?.args).toEqual({
      p_org_id: 'kc-org', p_entry_id: 'e1', p_void_reason: 'typed twice',
    });
    await expect(repoOf({ finance_ledger_mark: fail('P0001', 'entry_not_found') }).repo.delete('e1', 'typed twice'))
      .rejects.toMatchObject({ code: 'entry_not_found' });
    await expect(repoOf({ finance_ledger_mark: fail('P0001', 'void_reason_required') }).repo.delete('e1', 'x'))
      .rejects.toMatchObject({ code: 'void_reason_required' });
  });
});
