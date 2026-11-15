import { allowsMove, canTransition } from './fsm/machine';
import { accountStatusMachine } from './fsm/machines/accountStatus';

/**
 * Whether a moderator may ban the account (FR-ADMIN-004): the account graph has a move to
 * `banned`. An account already banned, one that is leaving (`pending_deletion`) and a status
 * the app does not know are not offered the ban.
 */
export function canBanAccount(status: string): boolean {
  return allowsMove(accountStatusMachine, status, 'banned');
}

/**
 * Whether the member may ask to delete their account (FR-AUTH-016): the account graph has a
 * move to `pending_deletion`. A repeated request is accepted (the server returns the same purge
 * date); a suspended or banned account is refused.
 */
export function canRequestAccountDeletion(status: string): boolean {
  return canTransition(accountStatusMachine, status, 'pending_deletion').ok;
}
