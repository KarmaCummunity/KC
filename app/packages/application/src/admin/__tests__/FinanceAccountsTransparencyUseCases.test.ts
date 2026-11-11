import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRANSPARENCY_SETTINGS, FinanceLedgerError, HIDDEN_TRANSPARENCY } from '@kc/domain';
import type { IFinanceAccountsRepository } from '../IFinanceAccountsRepository';
import type { IFinanceDonorsRepository } from '../IFinanceDonorsRepository';
import type {
  IOrgTransparencyRepository, ITransparencySettingsRepository,
} from '../IOrgTransparencyRepository';
import { ListFinanceAccountsUseCase } from '../ListFinanceAccountsUseCase';
import { UpsertFinanceAccountUseCase } from '../UpsertFinanceAccountUseCase';
import { ListFinanceDonorsUseCase } from '../ListFinanceDonorsUseCase';
import { GetOrgTransparencyUseCase } from '../GetOrgTransparencyUseCase';
import {
  GetTransparencySettingsUseCase, SetTransparencySettingsUseCase,
} from '../TransparencySettingsUseCases';

function accountsRepo() {
  return {
    list: vi.fn(async () => []),
    upsert: vi.fn(async () => 'acc-1'),
  } satisfies IFinanceAccountsRepository;
}

describe('UpsertFinanceAccountUseCase', () => {
  it('creates with a trimmed name', async () => {
    const repo = accountsRepo();
    await new UpsertFinanceAccountUseCase(repo).execute({ name: '  Main bank ', kind: 'bank', last4: '1234' });
    expect(repo.upsert).toHaveBeenCalledWith({ name: 'Main bank', kind: 'bank', last4: '1234' });
  });

  it('rejects create without a kind or name', async () => {
    const repo = accountsRepo();
    const uc = new UpsertFinanceAccountUseCase(repo);
    await expect(uc.execute({ name: 'X' })).rejects.toMatchObject({ code: 'missing_required_fields' });
    await expect(uc.execute({ kind: 'cash' })).rejects.toMatchObject({ code: 'missing_required_fields' });
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('rejects blank and over-long names', async () => {
    const uc = new UpsertFinanceAccountUseCase(accountsRepo());
    await expect(uc.execute({ name: '   ', kind: 'cash' })).rejects.toMatchObject({ code: 'invalid_name' });
    await expect(uc.execute({ name: 'x'.repeat(81), kind: 'cash' })).rejects.toBeInstanceOf(FinanceLedgerError);
  });

  it('accepts the maximum name length (boundary)', async () => {
    const repo = accountsRepo();
    await new UpsertFinanceAccountUseCase(repo).execute({ name: 'x'.repeat(80), kind: 'cash' });
    expect(repo.upsert).toHaveBeenCalled();
  });

  it('rejects a malformed last4 but allows empty (clear)', async () => {
    const repo = accountsRepo();
    const uc = new UpsertFinanceAccountUseCase(repo);
    await expect(uc.execute({ name: 'A', kind: 'bank', last4: '12a4' })).rejects.toMatchObject({ code: 'invalid_last4' });
    await uc.execute({ accountId: 'a1', last4: '' });
    expect(repo.upsert).toHaveBeenCalledWith({ accountId: 'a1', last4: '' });
  });

  it('updates skip the create-only requirements (e.g. deactivate)', async () => {
    const repo = accountsRepo();
    await new UpsertFinanceAccountUseCase(repo).execute({ accountId: 'a1', isActive: false });
    expect(repo.upsert).toHaveBeenCalledWith({ accountId: 'a1', isActive: false });
  });
});

describe('pass-through use cases', () => {
  it('lists accounts', async () => {
    const repo = accountsRepo();
    await new ListFinanceAccountsUseCase(repo).execute();
    expect(repo.list).toHaveBeenCalledOnce();
  });

  it('forwards the donors limit', async () => {
    const repo: IFinanceDonorsRepository = { summary: vi.fn(async () => []) };
    await new ListFinanceDonorsUseCase(repo).execute(10);
    expect(repo.summary).toHaveBeenCalledWith(10);
  });

  it('forwards the slug for the public payload', async () => {
    const repo: IOrgTransparencyRepository = { getPublic: vi.fn(async () => HIDDEN_TRANSPARENCY) };
    expect(await new GetOrgTransparencyUseCase(repo).execute('kc')).toBe(HIDDEN_TRANSPARENCY);
    expect(repo.getPublic).toHaveBeenCalledWith('kc');
  });
});

describe('transparency settings use cases', () => {
  function settingsRepo(): ITransparencySettingsRepository {
    return {
      get: vi.fn(async () => DEFAULT_TRANSPARENCY_SETTINGS),
      set: vi.fn(async () => ({ ...DEFAULT_TRANSPARENCY_SETTINGS, show_totals: true })),
    };
  }

  it('reads the settings', async () => {
    expect(await new GetTransparencySettingsUseCase(settingsRepo()).execute()).toEqual(DEFAULT_TRANSPARENCY_SETTINGS);
  });

  it('forwards a valid patch', async () => {
    const repo = settingsRepo();
    const out = await new SetTransparencySettingsUseCase(repo).execute({ show_totals: true });
    expect(repo.set).toHaveBeenCalledWith({ show_totals: true });
    expect(out.show_totals).toBe(true);
  });

  it('rejects an empty patch and unknown keys without calling the repo', () => {
    const repo = settingsRepo();
    const uc = new SetTransparencySettingsUseCase(repo);
    expect(() => uc.execute({})).toThrow(FinanceLedgerError);
    expect(() => uc.execute({ show_donor_names: true } as never)).toThrow(FinanceLedgerError);
    expect(repo.set).not.toHaveBeenCalled();
  });
});
