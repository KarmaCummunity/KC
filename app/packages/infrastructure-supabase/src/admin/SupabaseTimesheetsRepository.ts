// FR-ADMIN-033 — staff timesheets over the timesheet_* RPCs (supabase/migrations/0036).
//
// A member reports their own hours; the reporter's direct manager (or a super admin) decides
// a submitted entry, and the server marks each row it may decide (`can_decide`). The list is
// keyset-paged and its total comes from `timesheet_count` with the same filters.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ITimesheetsRepository, TimesheetListFilters, TimesheetUpsertInput } from '@kc/application';
import {
  TimesheetError,
  parseTimesheetStatus,
  type TimesheetEntry,
  type TimesheetErrorCode,
  type TimesheetPage,
} from '@kc/domain';
import type { Database, Json } from '../database.types';
import { toBackendUnavailable, type BackendErrorLike } from '../rpc/backendUnavailable';
import type { CallResult } from '../rpc/mapRpcError';
import { asRecord, date, decodeCursor, readPage, str } from './backOfficePaging';

type Client = SupabaseClient<Database>;

const DEFAULT_PAGE = 100;

const KNOWN_ERRORS: ReadonlySet<string> = new Set<TimesheetErrorCode>([
  'forbidden', 'invalid_status', 'invalid_hours', 'missing_required_fields', 'invalid_input', 'entry_not_found',
]);

function toError(err: BackendErrorLike): TimesheetError {
  const message = err.message ?? '';
  if (KNOWN_ERRORS.has(message)) return new TimesheetError(message as TimesheetErrorCode);
  if (err.code === '42501') return new TimesheetError('forbidden');
  return new TimesheetError('unknown', message || 'timesheet call failed');
}

function unwrap<T>(rpc: string, result: CallResult<T>): T {
  if (!result.error) return result.data;
  throw toBackendUnavailable(`rpc:${rpc}`, result.error) ?? toError(result.error);
}

/** An entry record; null when it is not an object or its status is unknown. */
export function mapTimesheetEntry(value: Json): TimesheetEntry | null {
  const row = asRecord(value);
  if (row === null) return null;
  const entryId = str(row, 'entry_id');
  const userId = str(row, 'user_id');
  const workDate = str(row, 'work_date');
  const status = parseTimesheetStatus(str(row, 'status'));
  const createdAt = date(row, 'created_at');
  const hours = row.hours_x100;
  if (entryId === null || userId === null || workDate === null || status === null || createdAt === null
      || typeof hours !== 'number') return null;
  return {
    entryId,
    userId,
    userName: str(row, 'user_name'),
    workDate,
    hoursX100: hours,
    project: str(row, 'project'),
    description: str(row, 'description'),
    status,
    submittedAt: date(row, 'submitted_at'),
    approvedAt: date(row, 'approved_at'),
    approvedBy: str(row, 'approved_by'),
    approverName: str(row, 'approver_name'),
    approvalNote: str(row, 'approval_note'),
    canDecide: row.can_decide === true,
    createdAt,
    updatedAt: date(row, 'updated_at') ?? createdAt,
  };
}

/** `undefined` keeps a field (null for the RPC); `null` clears it (an empty string). */
const patch = (value: string | null | undefined): string | undefined => (value === null ? '' : value);

export class SupabaseTimesheetsRepository implements ITimesheetsRepository {
  constructor(private readonly client: Client) {}

  async list(filters: TimesheetListFilters): Promise<TimesheetPage> {
    const limit = filters.limit ?? DEFAULT_PAGE;
    const shared = {
      p_scope: filters.scope ?? 'mine',
      p_user_id: filters.userId,
      p_status: filters.status,
      p_from: filters.fromDate,
      p_to: filters.toDate,
    };
    const [rows, total] = await Promise.all([
      this.client.rpc('timesheet_list', { ...shared, p_limit: limit, p_cursor: decodeCursor(filters.cursor) ?? undefined }),
      this.client.rpc('timesheet_count', shared),
    ]);
    const page = readPage(unwrap('timesheet_list', rows), limit, (row) => mapTimesheetEntry(row.entry));
    return { ...page, totalCount: unwrap('timesheet_count', total) ?? 0 };
  }

  async upsert(input: TimesheetUpsertInput): Promise<string> {
    const id = unwrap('timesheet_upsert', await this.client.rpc('timesheet_upsert', {
      p_entry_id: input.entryId ?? undefined,
      p_work_date: input.workDate,
      p_hours_x100: input.hoursX100,
      p_project: patch(input.project),
      p_description: patch(input.description),
    }));
    if (typeof id !== 'string') throw new TimesheetError('unknown', 'timesheet_upsert returned no id');
    return id;
  }

  async submit(entryId: string): Promise<void> {
    unwrap('timesheet_submit', await this.client.rpc('timesheet_submit', { p_entry_id: entryId }));
  }

  async approve(entryId: string, note?: string | null): Promise<void> {
    unwrap('timesheet_approve', await this.client.rpc('timesheet_approve', { p_entry_id: entryId, p_note: note ?? undefined }));
  }

  async reject(entryId: string, note?: string | null): Promise<void> {
    unwrap('timesheet_reject', await this.client.rpc('timesheet_reject', { p_entry_id: entryId, p_note: note ?? undefined }));
  }

  async delete(entryId: string): Promise<void> {
    unwrap('timesheet_delete', await this.client.rpc('timesheet_delete', { p_entry_id: entryId }));
  }
}
