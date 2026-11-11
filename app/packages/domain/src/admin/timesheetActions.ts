import { canTransition } from '../fsm/machine';
import { timesheetMachine } from '../fsm/machines/timesheet';
import type { TimesheetStatus } from './TimesheetEntry';

/** Who is looking at an entry: its author, and whether they hold an approver role. */
export interface TimesheetViewer {
  readonly isMine: boolean;
  readonly canApprove: boolean;
}

/** The actions the timesheet screen offers on one entry. */
export interface TimesheetActions {
  readonly edit: boolean;
  readonly submit: boolean;
  readonly delete: boolean;
  readonly decide: boolean;
}

/**
 * Derives the entry's actions from `timesheetMachine`, so the screen offers exactly what the
 * RPCs accept (`0171`):
 * - edit and delete: the author, while the entry is a draft or rejected. Editing a rejected
 *   entry is its move back to draft; delete is a soft delete from the same two states.
 * - submit: the author, from draft only (a rejected entry is edited first).
 * - decide (approve or reject): an approver, while the entry is submitted.
 */
export function timesheetActions(status: TimesheetStatus, viewer: TimesheetViewer): TimesheetActions {
  // A draft "moves" to draft as a same-status no-op; a rejected entry moves back to it.
  const editable = canTransition(timesheetMachine, status, 'draft').ok;
  const submittable = isMove(status, 'submitted');
  const decidable = isMove(status, 'approved') && isMove(status, 'rejected');
  return {
    edit: viewer.isMine && editable,
    submit: viewer.isMine && submittable,
    delete: viewer.isMine && editable,
    decide: viewer.canApprove && decidable,
  };
}

/** True only for a real edge out of `status` (a same-status write is not an action). */
function isMove(status: TimesheetStatus, to: TimesheetStatus): boolean {
  const answer = canTransition(timesheetMachine, status, to);
  return answer.ok && answer.changed;
}
