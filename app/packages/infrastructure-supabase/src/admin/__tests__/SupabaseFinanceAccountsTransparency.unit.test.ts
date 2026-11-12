// FR-FIN-003, FR-FIN-022, FR-FIN-023 — accounts, donors and transparency adapters on the baseline.
import { describe, expect, it } from 'vitest';
import { BackendUnavailableError, DEFAULT_TRANSPARENCY_SETTINGS, FinanceLedgerError, HIDDEN_TRANSPARENCY } from '@kc/domain';
import { callsTo, createFakeClient, type FakeClientConfig } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseFinanceAccountsRepository, mapFinanceAccountRow } from '../SupabaseFinanceAccountsRepository';
import { SupabaseFinanceDonorsRepository } from '../SupabaseFinanceDonorsRepository';
import {
  SupabaseOrgTransparencyRepository, SupabaseTransparencySettingsRepository, mapOrgTransparency, mapTransparencySettings,
} from '../SupabaseOrgTransparencyRepository';
import { toFinanceError } from '../financeErrors';

const PLATFORM = ok({ id: 'kc-org' });
const ACCOUNT = {
  id: 'a1', name: 'Bank', kind: 'bank', last4: '1234', opening_balance_agorot: 10000, opening_balance_at: '2030-01-01',
  is_active: true, sort_order: 0, balance_agorot: 12500,
};

const clientOf = (config: FakeClientConfig) => createFakeClient({ ...config, tables: { organizations: PLATFORM, ...config.tables } });

describe('toFinanceError', () => {
  it('maps baseline reasons and SQLSTATEs and falls back to unknown', () => {
    expect(toFinanceError({ code: '42501', message: 'forbidden' }).code).toBe('forbidden');
    expect(toFinanceError({ code: 'P0001', message: 'entry_reconciled' }).code).toBe('invalid_status');
    expect(toFinanceError({ code: 'P0001', message: 'account_not_found' }).code).toBe('account_not_found');
    expect(toFinanceError({ code: 'XX000', message: 'boom' }).code).toBe('unknown');
  });
});

describe('SupabaseFinanceAccountsRepository', () => {
  it('maps a row in agorot with the date pinned to noon UTC and no entry count', () => {
    expect(mapFinanceAccountRow(ACCOUNT)).toMatchObject({
      accountId: 'a1', openingBalanceCents: 10000, balanceCents: 12500, entryCount: null,
      openingBalanceAt: new Date('2030-01-01T12:00:00.000Z'),
    });
    expect(mapFinanceAccountRow({ ...ACCOUNT, kind: 'vault' })).toBeNull();
  });

  it('lists and writes the accounts of the platform organization', async () => {
    const { client, calls } = clientOf({ rpc: { finance_accounts_list: ok([ACCOUNT]), finance_account_upsert: ok('a2') } });
    const repo = new SupabaseFinanceAccountsRepository(client);
    expect(await repo.list()).toHaveLength(1);
    expect(await repo.upsert({ name: 'Cash', kind: 'cash', last4: '', openingBalanceCents: 500, openingBalanceAt: new Date('2030-02-03T00:00:00Z') }))
      .toBe('a2');
    expect(callsTo(calls, 'finance_accounts_list')[0]?.args).toEqual({ p_org_id: 'kc-org' });
    expect(callsTo(calls, 'finance_account_upsert')[0]?.args).toMatchObject({
      p_org_id: 'kc-org', p_name: 'Cash', p_kind: 'cash', p_last4: undefined, p_opening_balance_agorot: 500,
      p_opening_balance_at: '2030-02-03',
    });
  });

  it('maps a refusal and a missing function', async () => {
    const refused = clientOf({ rpc: { finance_account_upsert: fail('42501', 'forbidden') } });
    await expect(new SupabaseFinanceAccountsRepository(refused.client).upsert({ name: 'x' })).rejects.toBeInstanceOf(FinanceLedgerError);
    const missing = clientOf({ rpc: { finance_accounts_list: fail('PGRST202', 'nope') } });
    await expect(new SupabaseFinanceAccountsRepository(missing.client).list()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('SupabaseFinanceDonorsRepository', () => {
  it('maps the donor groups and forwards the organization and the limit', async () => {
    const { client, calls } = clientOf({ rpc: { finance_donors_summary: ok([
      { donor_name: null, donations_count: 2, total_agorot: 300, first_at: '2030-01-01T00:00:00Z', last_at: '2030-01-03T00:00:00Z' },
    ]) } });
    const [donor] = await new SupabaseFinanceDonorsRepository(client).summary(5);
    expect(donor).toEqual({ donorName: null, donationsCount: 2, totalCents: 300, firstAt: new Date('2030-01-01T00:00:00Z'), lastAt: new Date('2030-01-03T00:00:00Z') });
    expect(callsTo(calls, 'finance_donors_summary')[0]?.args).toEqual({ p_org_id: 'kc-org', p_limit: 5 });
  });
});

describe('transparency', () => {
  it('degrades to hidden for disabled or malformed payloads and maps the agorot blocks', () => {
    expect(mapOrgTransparency(null)).toBe(HIDDEN_TRANSPARENCY);
    expect(mapOrgTransparency({ enabled: false })).toBe(HIDDEN_TRANSPARENCY);
    expect(mapOrgTransparency({
      enabled: true, currency: 'ILS', last_entry_at: 'not a date', income_agorot: 4500, expense_agorot: '300', net_agorot: 4200,
      by_category: [{ key: 'program', agorot: 300 }], monthly: [{ month: '2030-01', income_agorot: 4500, expense_agorot: 300 }],
    })).toMatchObject({
      lastEntryAt: null, totals: { incomeCents: 4500, expenseCents: 300, netCents: 4200 },
      byCategory: [{ key: 'program', cents: 300 }], monthly: [{ month: '2030-01', incomeCents: 4500, expenseCents: 300 }],
    });
  });

  it('reads the public numbers by slug', async () => {
    const { client, calls } = clientOf({ rpc: { rpc_org_transparency: ok({ enabled: false }) } });
    expect(await new SupabaseOrgTransparencyRepository(client).getPublic()).toBe(HIDDEN_TRANSPARENCY);
    expect(callsTo(calls, 'rpc_org_transparency')[0]?.args).toEqual({ p_slug: undefined });
  });

  it('reads the switches from the platform organization row and writes them through the RPC', async () => {
    const row = { ...DEFAULT_TRANSPARENCY_SETTINGS, show_totals: true };
    const { client, calls } = createFakeClient({
      tables: { organizations: (call) => ok(call.columns === 'id' ? { id: 'kc-org' } : row) },
      rpc: { finance_transparency_settings_set: ok(null) },
    });
    const repo = new SupabaseTransparencySettingsRepository(client);
    expect((await repo.set({ show_totals: true })).show_totals).toBe(true);
    expect(callsTo(calls, 'finance_transparency_settings_set')[0]?.args).toEqual({ p_org_id: 'kc-org', p_settings: { show_totals: true } });
    const reads = callsTo(calls, 'organizations');
    expect(reads[reads.length - 1]?.filters).toEqual([['eq', 'id', 'kc-org']]);
    expect(mapTransparencySettings('junk')).toBe(DEFAULT_TRANSPARENCY_SETTINGS);
  });
});
