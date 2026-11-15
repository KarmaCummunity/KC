// Account actions are read from `accountStatusMachine` and match `admin_ban_user` and
// `request_account_deletion` (supabase/schemas/60_moderation, 10_identity).
import { describe, expect, it } from 'vitest';
import { canBanAccount, canRequestAccountDeletion } from '../accountActions';
import { accountStatusMachine } from '../fsm/machines/accountStatus';

/** The account statuses for which the predicate holds, in the machine's order. */
function statusesWhere(predicate: (status: string) => boolean): readonly string[] {
  return accountStatusMachine.states.filter(predicate);
}

describe('canBanAccount', () => {
  it('offers the ban to every account that is not banned yet and not leaving', () => {
    expect(statusesWhere(canBanAccount)).toEqual([
      'pending_verification',
      'active',
      'suspended_for_false_reports',
      'suspended_admin',
    ]);
  });

  it('offers nothing on a status the app does not know', () => {
    expect(canBanAccount('a_newer_status')).toBe(false);
  });
});

describe('canRequestAccountDeletion', () => {
  it('lets an active or unverified member leave, and accepts a repeated request', () => {
    expect(statusesWhere(canRequestAccountDeletion)).toEqual(['pending_verification', 'active', 'pending_deletion']);
  });

  it('refuses a suspended or banned account and an unknown status', () => {
    expect(canRequestAccountDeletion('suspended_admin')).toBe(false);
    expect(canRequestAccountDeletion('suspended_for_false_reports')).toBe(false);
    expect(canRequestAccountDeletion('banned')).toBe(false);
    expect(canRequestAccountDeletion('a_newer_status')).toBe(false);
  });
});
