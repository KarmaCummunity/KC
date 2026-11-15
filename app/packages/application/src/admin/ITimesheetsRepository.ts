// FR-ADMIN-033 — port for staff timesheets.
import type { TimesheetPage, TimesheetScope, TimesheetStatus } from '@kc/domain';

export interface TimesheetListFilters {
  /** Defaults to the viewer's own entries. */
  readonly scope?: TimesheetScope;
  readonly userId?: string;
  readonly status?: TimesheetStatus;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly limit?: number;
  /** `nextCursor` of the previous page; omitted for the first page. */
  readonly cursor?: string;
}

export interface TimesheetUpsertInput {
  readonly entryId?: string | null;
  readonly workDate?: string;
  readonly hoursX100?: number;
  readonly project?: string | null;
  readonly description?: string | null;
}

export interface ITimesheetsRepository {
  list(filters: TimesheetListFilters): Promise<TimesheetPage>;
  upsert(input: TimesheetUpsertInput): Promise<string>;
  submit(entryId: string): Promise<void>;
  approve(entryId: string, note?: string | null): Promise<void>;
  reject(entryId: string, note?: string | null): Promise<void>;
  delete(entryId: string): Promise<void>;
}
