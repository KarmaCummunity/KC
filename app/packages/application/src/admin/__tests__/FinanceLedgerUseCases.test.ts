import { describe, expect, it, vi } from 'vitest';
import { FinanceLedgerError } from '@kc/domain';
import { DeleteFinanceEntryUseCase } from '../DeleteFinanceEntryUseCase';
import { GetFinanceSummaryUseCase } from '../GetFinanceSummaryUseCase';
import { ListFinanceLedgerUseCase } from '../ListFinanceLedgerUseCase';
import { UpsertFinanceEntryUseCase } from '../UpsertFinanceEntryUseCase';
import type { IFinanceLedgerRepository } from '../IFinanceLedgerRepository';

function makeRepo(): IFinanceLedgerRepository & {
  list:    ReturnType<typeof vi.fn>;
  upsert:  ReturnType<typeof vi.fn>;
  delete:  ReturnType<typeof vi.fn>;
  summary: ReturnType<typeof vi.fn>;
} {
  return {
    list:    vi.fn(async () => ({ rows: [], nextCursor: null })),
    upsert:  vi.fn(async () => 'id-1'),
    delete:  vi.fn(async () => undefined),
    summary: vi.fn(async () => []),
  };
}

describe('Finance ledger use cases — pass-throughs', () => {
  it('Delete forwards the id', async () => {
    const repo = makeRepo();
    await new DeleteFinanceEntryUseCase(repo).execute('e1');
    expect(repo.delete).toHaveBeenCalledWith('e1');
  });

  it('List forwards filters', async () => {
    const repo = makeRepo();
    await new ListFinanceLedgerUseCase(repo).execute({ limit: 10 });
    expect(repo.list).toHaveBeenCalledWith({ limit: 10 });
  });

  it('Summary forwards from/to dates', async () => {
    const repo = makeRepo();
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to   = new Date('2026-01-31T00:00:00.000Z');
    await new GetFinanceSummaryUseCase(repo).execute({ fromDate: from, toDate: to });
    expect(repo.summary).toHaveBeenCalledWith(from, to);
  });
});

describe('UpsertFinanceEntryUseCase', () => {
  it('rejects creation without a kind', async () => {
    const repo = makeRepo();
    await expect(
      new UpsertFinanceEntryUseCase(repo).execute({ amountCents: 100 }),
    ).rejects.toBeInstanceOf(FinanceLedgerError);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('rejects creation with a missing amount', async () => {
    const repo = makeRepo();
    await expect(
      new UpsertFinanceEntryUseCase(repo).execute({ kind: 'donation_in' } as never),
    ).rejects.toBeInstanceOf(FinanceLedgerError);
  });

  it('rejects creation with a negative amount', async () => {
    const repo = makeRepo();
    await expect(
      new UpsertFinanceEntryUseCase(repo).execute({ kind: 'donation_in', amountCents: -1 } as never),
    ).rejects.toBeInstanceOf(FinanceLedgerError);
  });

  it('allows zero amount on create', async () => {
    const repo = makeRepo();
    const input = { kind: 'donation_in', amountCents: 0 } as never;
    await new UpsertFinanceEntryUseCase(repo).execute(input);
    expect(repo.upsert).toHaveBeenCalledWith(input);
  });

  it('updates skip the create-only checks', async () => {
    const repo = makeRepo();
    const input = { entryId: 'e1', description: 'note' } as never;
    await new UpsertFinanceEntryUseCase(repo).execute(input);
    expect(repo.upsert).toHaveBeenCalledWith(input);
  });
});
