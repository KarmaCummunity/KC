import { TIMESHEET_STATUSES } from '../../admin/TimesheetEntry';
import { defineMachine } from '../machine';

/**
 * Admin timesheet entry lifecycle (`timesheet_entries.status`, FR-ADMIN-033).
 *
 * - The author fills a draft and submits it (`timesheet_upsert`, `timesheet_submit`).
 * - The author's direct manager in the staff hierarchy, or a super admin, decides a submitted
 *   entry once (`timesheet_approve` / `timesheet_reject`); nobody decides their own entry.
 * - Editing a rejected entry sends it back to draft, to be submitted again. An approved entry
 *   is final.
 *
 * Who may make each move stays in the RPCs (author or manager); the graph holds what
 * may follow what. Deleting an entry is a soft delete (`deleted_at`), not a status.
 *
 * SQL copy: `supabase/migrations/0036_back_office_timesheets.sql`.
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
