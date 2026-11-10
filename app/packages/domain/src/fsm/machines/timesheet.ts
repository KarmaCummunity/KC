import { TIMESHEET_STATUSES } from '../../admin/TimesheetEntry';
import { defineMachine } from '../machine';

/**
 * Admin timesheet entry lifecycle (`timesheet_entries.status`, V2-ADMIN-TIME-10, `0171`).
 *
 * - The author fills a draft and submits it (`timesheet_upsert`, `timesheet_submit`).
 * - An approver (super admin or moderator) decides a submitted entry once
 *   (`timesheet_decide`, through `timesheet_approve` / `timesheet_reject`).
 * - Editing a rejected entry sends it back to draft, to be submitted again. An approved entry
 *   is final.
 *
 * Who may make each move stays in the RPCs (author or approver role); the graph holds what
 * may follow what. Deleting an entry is a soft delete (`deleted_at`), not a status.
 *
 * SQL copy: `supabase/migrations/0718_fsm_timesheets.sql`.
 */
export const timesheetMachine = defineMachine({
  id: 'timesheet',
  states: TIMESHEET_STATUSES,
  edges: [
    { from: 'draft', to: 'submitted' },
    { from: 'submitted', to: 'approved' },
    { from: 'submitted', to: 'rejected' },
    { from: 'rejected', to: 'draft' },
  ],
});
