// FR-ADMIN-033 — use cases for staff timesheets.
import { TimesheetError, type TimesheetPage } from '@kc/domain';
import type {
  ITimesheetsRepository, TimesheetListFilters, TimesheetUpsertInput,
} from './ITimesheetsRepository';

export class ListTimesheetsUseCase {
  constructor(private readonly repo: ITimesheetsRepository) {}
  execute(filters: TimesheetListFilters): Promise<TimesheetPage> { return this.repo.list(filters); }
}

export class UpsertTimesheetUseCase {
  constructor(private readonly repo: ITimesheetsRepository) {}
  async execute(input: TimesheetUpsertInput): Promise<string> {
    if (!input.entryId) {
      if (!input.workDate || input.hoursX100 == null) {
        throw new TimesheetError('missing_required_fields');
      }
      if (input.hoursX100 < 0 || input.hoursX100 > 2400) {
        throw new TimesheetError('invalid_hours');
      }
    }
    return this.repo.upsert(input);
  }
}

export class SubmitTimesheetUseCase {
  constructor(private readonly repo: ITimesheetsRepository) {}
  async execute(entryId: string): Promise<void> { await this.repo.submit(entryId); }
}

export class ApproveTimesheetUseCase {
  constructor(private readonly repo: ITimesheetsRepository) {}
  async execute(input: { entryId: string; note?: string | null }): Promise<void> {
    await this.repo.approve(input.entryId, input.note ?? null);
  }
}

export class RejectTimesheetUseCase {
  constructor(private readonly repo: ITimesheetsRepository) {}
  async execute(input: { entryId: string; note?: string | null }): Promise<void> {
    await this.repo.reject(input.entryId, input.note ?? null);
  }
}

export class DeleteTimesheetUseCase {
  constructor(private readonly repo: ITimesheetsRepository) {}
  async execute(entryId: string): Promise<void> { await this.repo.delete(entryId); }
}
