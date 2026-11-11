// V2-ADMIN-TIME-10 — staff timesheets (not in the spec).
//
// The production baseline has no timesheets (docs/db/app-migration-map.md, M19): back-office
// tools are internal data, and whether they belong in this database is an open product
// decision. The adapter therefore makes no call: every method reports the capability as
// missing with `BackendUnavailableError`, and the timesheets screen shows its unavailable state
// (apps/mobile/src/lib/parkedFeatures.ts). The previous RPC adapter is in git history.
import type {
  ITimesheetsRepository,
  TimesheetListFilters,
  TimesheetUpsertInput,
} from '@kc/application';
import { BackendUnavailableError, type TimesheetPage } from '@kc/domain';

const unavailable = (rpc: string): Promise<never> =>
  Promise.reject(new BackendUnavailableError(`rpc:${rpc}`, 'function'));

export class SupabaseTimesheetsRepository implements ITimesheetsRepository {
  list(_filters: TimesheetListFilters): Promise<TimesheetPage> {
    return unavailable('timesheet_list');
  }

  upsert(_input: TimesheetUpsertInput): Promise<string> {
    return unavailable('timesheet_upsert');
  }

  submit(_entryId: string): Promise<void> {
    return unavailable('timesheet_submit');
  }

  approve(_entryId: string, _note?: string | null): Promise<void> {
    return unavailable('timesheet_approve');
  }

  reject(_entryId: string, _note?: string | null): Promise<void> {
    return unavailable('timesheet_reject');
  }

  delete(_entryId: string): Promise<void> {
    return unavailable('timesheet_delete');
  }
}
