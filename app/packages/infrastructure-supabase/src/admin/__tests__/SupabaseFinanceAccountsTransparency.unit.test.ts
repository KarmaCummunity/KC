import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_TRANSPARENCY_SETTINGS, HIDDEN_TRANSPARENCY, isFinanceLedgerError,
} from '@kc/domain';
import { toFinanceError } from '../financeErrors';
import {
  SupabaseFinanceAccountsRepository, mapFinanceAccountRow,
} from '../SupabaseFinanceAccountsRepository';
import { SupabaseFinanceDonorsRepository } from '../SupabaseFinanceDonorsRepository';
import {
  SupabaseOrgTransparencyRepository, SupabaseTransparencySettingsRepository,
  mapOrgTransparency, mapTransparencySettings,
} from '../SupabaseOrgTransparencyRepository';

function mockClient(rpc: (name: string, args?: unknown) => unknown): SupabaseClient {
  return { rpc: vi.fn(rpc as never) } as unknown as SupabaseClient;
}

const accountRow = {
  account_id: 'a1', name: 'Main', kind: 'bank', last4: '1234',
  opening_balance_cents: '100000', opening_balance_at: '2026-01-31', is_active: true,
  sort_order: 1, balance_cents: '120000', entry_count: 3,
};

describe('toFinanceError', () => {
  it.each([
    ['account_name_taken', 'account_name_taken'],
    ['account_not_found', 'account_not_found'],
    ['invalid_settings', 'invalid_settings'],
    ['invalid_last4', 'invalid_last4'],
  ])('maps message %s', (message, code) => {
    expect(toFinanceError({ message }).code).toBe(code);
  });

  it('maps SQLSTATEs and falls back to unknown without leaking details as a code', () => {
    expect(toFinanceError({ code: '42501', message: 'x' }).code).toBe('forbidden');
    expect(toFinanceError({ code: 'P0002', message: 'x' }).code).toBe('entry_not_found');
    expect(toFinanceError({ message: 'boom' }).code).toBe('unknown');
    expect(toFinanceError(null).code).toBe('unknown');
  });
});

describe('SupabaseFinanceAccountsRepository', () => {
  it('maps a row (string bigint, date column pinned to noon UTC)', () => {
    const a = mapFinanceAccountRow(accountRow);
    expect(a).toMatchObject({
      accountId: 'a1', kind: 'bank', last4: '1234',
      openingBalanceCents: 100000, balanceCents: 120000, entryCount: 3, isActive: true,
    });
    expect(a?.openingBalanceAt?.toISOString()).toBe('2026-01-31T12:00:00.000Z');
  });

  it('drops rows with an unknown kind and tolerates a null opening date', async () => {
    const repo = new SupabaseFinanceAccountsRepository(mockClient(() => ({
      data: [accountRow, { ...accountRow, account_id: 'a2', kind: 'crypto' },
             { ...accountRow, account_id: 'a3', opening_balance_at: null }],
      error: null,
    })));
    const out = await repo.list();
    expect(out.map((a) => a.accountId)).toEqual(['a1', 'a3']);
    expect(out[1]?.openingBalanceAt).toBeNull();
  });

  it('upsert sends nulls for omitted fields and the date as YYYY-MM-DD', async () => {
    const spy = vi.fn(() => ({ data: 'new-id', error: null }));
    const repo = new SupabaseFinanceAccountsRepository(mockClient(spy as never));
    const id = await repo.upsert({
      name: 'Cash', kind: 'cash', openingBalanceCents: 500,
      openingBalanceAt: new Date('2026-03-05T12:00:00.000Z'),
    });
    expect(id).toBe('new-id');
    expect(spy).toHaveBeenCalledWith('finance_account_upsert', {
      p_account_id: null, p_name: 'Cash', p_kind: 'cash', p_last4: null,
      p_opening_balance_cents: 500, p_opening_balance_at: '2026-03-05',
      p_is_active: null, p_sort_order: null,
    });
  });

  it('maps server errors and a non-string result', async () => {
    const taken = new SupabaseFinanceAccountsRepository(
      mockClient(() => ({ data: null, error: { message: 'account_name_taken' } })));
    await expect(taken.upsert({ name: 'X', kind: 'cash' })).rejects.toSatisfy(
      (e) => isFinanceLedgerError(e) && e.code === 'account_name_taken');

    const bad = new SupabaseFinanceAccountsRepository(mockClient(() => ({ data: 42, error: null })));
    await expect(bad.upsert({ name: 'X', kind: 'cash' })).rejects.toSatisfy(
      (e) => isFinanceLedgerError(e) && e.code === 'unknown');
  });
});

describe('SupabaseFinanceDonorsRepository', () => {
  it('maps rows and forwards the limit', async () => {
    const spy = vi.fn(() => ({
      data: [{ donor_name: null, donations_count: '2', total_cents: 900,
               first_at: '2026-01-01T00:00:00.000Z', last_at: '2026-02-01T00:00:00.000Z' }],
      error: null,
    }));
    const out = await new SupabaseFinanceDonorsRepository(mockClient(spy as never)).summary(50);
    expect(spy).toHaveBeenCalledWith('finance_donors_summary', { p_limit: 50 });
    expect(out[0]).toMatchObject({ donorName: null, donationsCount: 2, totalCents: 900 });
    expect(out[0]?.lastAt).toBeInstanceOf(Date);
  });

  it('surfaces forbidden for non-admins', async () => {
    const repo = new SupabaseFinanceDonorsRepository(
      mockClient(() => ({ data: null, error: { code: '42501', message: 'forbidden' } })));
    await expect(repo.summary()).rejects.toSatisfy((e) => isFinanceLedgerError(e) && e.code === 'forbidden');
  });
});

describe('mapOrgTransparency', () => {
  it('degrades to hidden for disabled, malformed or non-object payloads', () => {
    expect(mapOrgTransparency({ enabled: false })).toBe(HIDDEN_TRANSPARENCY);
    expect(mapOrgTransparency(null)).toBe(HIDDEN_TRANSPARENCY);
    expect(mapOrgTransparency('x')).toBe(HIDDEN_TRANSPARENCY);
    expect(mapOrgTransparency([])).toBe(HIDDEN_TRANSPARENCY);
  });

  it('maps only the blocks the server sent', () => {
    const t = mapOrgTransparency({
      enabled: true, currency: 'ILS', last_entry_at: '2026-05-01T10:00:00.000Z',
      income_cents: 10000, expense_cents: '5000', net_cents: 5000,
    });
    expect(t.totals).toEqual({ incomeCents: 10000, expenseCents: 5000, netCents: 5000 });
    expect(t.byCategory).toBeNull();
    expect(t.monthly).toBeNull();
    expect(t.donationsCount).toBeNull();
    expect(t.programRatio).toBeNull();
    expect(t.lastEntryAt?.toISOString()).toBe('2026-05-01T10:00:00.000Z');
  });

  it('maps breakdown, trend, count and ratio', () => {
    const t = mapOrgTransparency({
      enabled: true, donations_count: 4, program_ratio: 0.8,
      by_category: [{ key: 'program', cents: 4000 }, { key: 'other_out', cents: '1000' }],
      monthly: [{ month: '2026-05', income_cents: 10, expense_cents: null }],
    });
    expect(t.donationsCount).toBe(4);
    expect(t.programRatio).toBe(0.8);
    expect(t.byCategory).toEqual([{ key: 'program', cents: 4000 }, { key: 'other_out', cents: 1000 }]);
    expect(t.monthly).toEqual([{ month: '2026-05', incomeCents: 10, expenseCents: 0 }]);
    expect(t.totals).toBeNull();
  });

  it('ignores an unparseable timestamp instead of producing Invalid Date', () => {
    expect(mapOrgTransparency({ enabled: true, last_entry_at: 'garbage' }).lastEntryAt).toBeNull();
  });
});

describe('transparency repositories', () => {
  it('mapTransparencySettings defaults unknown / missing keys to off', () => {
    expect(mapTransparencySettings(null)).toBe(DEFAULT_TRANSPARENCY_SETTINGS);
    expect(mapTransparencySettings({ show_totals: true, show_totals_typo: true, show_monthly_trend: 'yes' }))
      .toEqual({ ...DEFAULT_TRANSPARENCY_SETTINGS, show_totals: true });
  });

  it('getPublic passes the slug (null for the platform org)', async () => {
    const spy = vi.fn(() => ({ data: { enabled: false }, error: null }));
    const repo = new SupabaseOrgTransparencyRepository(mockClient(spy as never));
    expect(await repo.getPublic()).toBe(HIDDEN_TRANSPARENCY);
    expect(spy).toHaveBeenCalledWith('rpc_org_transparency', { p_slug: null });
    await repo.getPublic('kc');
    expect(spy).toHaveBeenLastCalledWith('rpc_org_transparency', { p_slug: 'kc' });
  });

  it('settings get/set round-trip through the RPCs', async () => {
    const spy = vi.fn((name: string) => ({
      data: name === 'finance_transparency_settings_get' ? {} : { show_totals: true },
      error: null,
    }));
    const repo = new SupabaseTransparencySettingsRepository(mockClient(spy as never));
    expect(await repo.get()).toEqual(DEFAULT_TRANSPARENCY_SETTINGS);
    expect((await repo.set({ show_totals: true })).show_totals).toBe(true);
    expect(spy).toHaveBeenLastCalledWith('finance_transparency_settings_set', { p_settings: { show_totals: true } });
  });

  it('settings set maps invalid_settings', async () => {
    const repo = new SupabaseTransparencySettingsRepository(
      mockClient(() => ({ data: null, error: { message: 'invalid_settings' } })));
    await expect(repo.set({ show_totals: true })).rejects.toSatisfy(
      (e) => isFinanceLedgerError(e) && e.code === 'invalid_settings');
  });
});
