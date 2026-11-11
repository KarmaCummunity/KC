import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal } from '../../fsm/machine';
import { timesheetMachine } from '../../fsm/machines/timesheet';
import { timesheetActions } from '../timesheetActions';

const author = { isMine: true, canApprove: false };
const approver = { isMine: false, canApprove: true };

describe('timesheet machine', () => {
  it('runs draft → submitted → approved | rejected, and a rejected entry back to draft', () => {
    expect(canTransition(timesheetMachine, 'draft', 'submitted').ok).toBe(true);
    expect(canTransition(timesheetMachine, 'submitted', 'approved').ok).toBe(true);
    expect(canTransition(timesheetMachine, 'submitted', 'rejected').ok).toBe(true);
    expect(canTransition(timesheetMachine, 'rejected', 'draft').ok).toBe(true);
  });

  it('keeps an approval final and never skips the review', () => {
    expect(isTerminal(timesheetMachine, 'approved')).toBe(true);
    expect(canTransition(timesheetMachine, 'draft', 'approved')).toEqual({ ok: false, code: 'illegal_transition' });
    expect(canTransition(timesheetMachine, 'rejected', 'submitted').ok).toBe(false);
    expect(canTransition(timesheetMachine, 'submitted', 'draft').ok).toBe(false);
  });
});

describe('timesheetActions', () => {
  it('lets the author edit, submit and delete a draft', () => {
    expect(timesheetActions('draft', author)).toEqual({ edit: true, submit: true, delete: true, decide: false });
  });

  it('lets the author edit or delete a rejected entry, matching timesheet_delete (0171)', () => {
    expect(timesheetActions('rejected', author)).toEqual({ edit: true, submit: false, delete: true, decide: false });
  });

  it('offers only the decision on a submitted entry, to an approver', () => {
    expect(timesheetActions('submitted', author)).toEqual({ edit: false, submit: false, delete: false, decide: false });
    expect(timesheetActions('submitted', approver)).toEqual({ edit: false, submit: false, delete: false, decide: true });
  });

  it('offers nothing on an approved entry', () => {
    expect(timesheetActions('approved', { isMine: true, canApprove: true })).toEqual({
      edit: false, submit: false, delete: false, decide: false,
    });
  });

  it('gives another member no author actions on a draft', () => {
    expect(timesheetActions('draft', approver)).toEqual({ edit: false, submit: false, delete: false, decide: false });
  });
});
