import { describe, expect, it, vi } from 'vitest';
import { TimesheetError } from '@kc/domain';
import {
  ApproveTimesheetUseCase,
  DeleteTimesheetUseCase,
  ListTimesheetsUseCase,
  RejectTimesheetUseCase,
  SubmitTimesheetUseCase,
  UpsertTimesheetUseCase,
} from '../TimesheetUseCases';
import type { ITimesheetsRepository } from '../ITimesheetsRepository';

function makeRepo(): ITimesheetsRepository & {
  list:    ReturnType<typeof vi.fn>;
  upsert:  ReturnType<typeof vi.fn>;
  submit:  ReturnType<typeof vi.fn>;
  approve: ReturnType<typeof vi.fn>;
  reject:  ReturnType<typeof vi.fn>;
  delete:  ReturnType<typeof vi.fn>;
} {
  return {
    list:    vi.fn(async () => ({ rows: [], totalCount: 0, nextCursor: null })),
    upsert:  vi.fn(async () => 't1'),
    submit:  vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined),
    reject:  vi.fn(async () => undefined),
    delete:  vi.fn(async () => undefined),
  };
}

describe('Timesheet use cases — pass-throughs', () => {
  it('List forwards filters', async () => {
    const repo = makeRepo();
    await new ListTimesheetsUseCase(repo).execute({ status: 'submitted' } as never);
    expect(repo.list).toHaveBeenCalledWith({ status: 'submitted' });
  });

  it('Submit forwards the id', async () => {
    const repo = makeRepo();
    await new SubmitTimesheetUseCase(repo).execute('t1');
    expect(repo.submit).toHaveBeenCalledWith('t1');
  });

  it('Approve forwards id and note', async () => {
    const repo = makeRepo();
    await new ApproveTimesheetUseCase(repo).execute({ entryId: 't1', note: 'ok' });
    expect(repo.approve).toHaveBeenCalledWith('t1', 'ok');
  });

  it('Approve defaults note to null when omitted', async () => {
    const repo = makeRepo();
    await new ApproveTimesheetUseCase(repo).execute({ entryId: 't1' });
    expect(repo.approve).toHaveBeenCalledWith('t1', null);
  });

  it('Reject forwards id and note', async () => {
    const repo = makeRepo();
    await new RejectTimesheetUseCase(repo).execute({ entryId: 't2', note: 'no' });
    expect(repo.reject).toHaveBeenCalledWith('t2', 'no');
  });

  it('Delete forwards the id', async () => {
    const repo = makeRepo();
    await new DeleteTimesheetUseCase(repo).execute('t3');
    expect(repo.delete).toHaveBeenCalledWith('t3');
  });
});

describe('UpsertTimesheetUseCase', () => {
  it('rejects creation without workDate', async () => {
    const repo = makeRepo();
    await expect(
      new UpsertTimesheetUseCase(repo).execute({ hoursX100: 100 }),
    ).rejects.toBeInstanceOf(TimesheetError);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('rejects creation without hoursX100', async () => {
    const repo = makeRepo();
    await expect(
      new UpsertTimesheetUseCase(repo).execute({ workDate: '2026-01-01' }),
    ).rejects.toBeInstanceOf(TimesheetError);
  });

  it('rejects negative hours', async () => {
    const repo = makeRepo();
    await expect(
      new UpsertTimesheetUseCase(repo).execute({ workDate: '2026-01-01', hoursX100: -1 }),
    ).rejects.toBeInstanceOf(TimesheetError);
  });

  it('rejects hours above 24h (>2400)', async () => {
    const repo = makeRepo();
    await expect(
      new UpsertTimesheetUseCase(repo).execute({ workDate: '2026-01-01', hoursX100: 2500 }),
    ).rejects.toBeInstanceOf(TimesheetError);
  });

  it('accepts boundary values 0 and 2400', async () => {
    const repo = makeRepo();
    await new UpsertTimesheetUseCase(repo).execute({ workDate: '2026-01-01', hoursX100: 0 });
    await new UpsertTimesheetUseCase(repo).execute({ workDate: '2026-01-01', hoursX100: 2400 });
    expect(repo.upsert).toHaveBeenCalledTimes(2);
  });

  it('updates skip the create-only checks', async () => {
    const repo = makeRepo();
    await new UpsertTimesheetUseCase(repo).execute({ entryId: 't1', description: 'note' });
    expect(repo.upsert).toHaveBeenCalled();
  });
});
