import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountGateReason, AccountGateResult, IAccountGateRepository } from '@kc/application';
import { InfrastructureError, RestoreAccountError } from '@kc/application';
import type { RestoreAccountErrorCode } from '@kc/application';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { fetchBootstrapSession, type BootstrapAccount } from './bootstrapSession';

/** Account statuses that keep a member out of the main screens, exactly the gate reasons. */
const GATE_REASONS: readonly AccountGateReason[] = [
  'pending_verification',
  'banned',
  'suspended_admin',
  'suspended_for_false_reports',
  'pending_deletion',
];

/** Stable refusals of `restore_account` mapped to the use case's error codes. */
const RESTORE_CODES: Readonly<Record<string, RestoreAccountErrorCode>> = {
  grace_expired: 'grace_expired',
  not_pending_deletion: 'not_pending_deletion',
  unauthenticated: 'unauthenticated',
};

/** The gate decision for an account: allowed only when it is `active`. */
function gateFromAccount(account: BootstrapAccount): AccountGateResult {
  if (account.status === 'active') return { allowed: true };
  const reason = GATE_REASONS.find((candidate) => candidate === account.status);
  if (!reason) throw new InfrastructureError(`unknown account status: ${account.status}`);
  // A pending deletion is restorable until its purge date; a suspension ends at `status_until`.
  const until = reason === 'pending_deletion' ? account.deletionPurgeAt : account.statusUntil;
  return { allowed: false, reason, until: until ?? undefined };
}

/**
 * FR-MOD-010 — the account gate is the `account` block of `bootstrap_session()`: the caller's
 * own status, so the gate takes no user argument and has no `allowed` flag of its own; the app
 * derives it from the status.
 */
export class SupabaseAccountGateRepository implements IAccountGateRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** `_userId` is kept by the port; the server reads the identity from the session. */
  async checkAccountGate(_userId: string): Promise<AccountGateResult> {
    const session = await fetchBootstrapSession(this.client);
    return gateFromAccount(session.account);
  }

  /** FR-AUTH-016 — `restore_account`; its stable refusal reason becomes the error code. */
  async restoreAccount(): Promise<void> {
    try {
      unwrapCall('rpc:restore_account', await this.client.rpc('restore_account'));
    } catch (error) {
      if (error instanceof BackendRuleError) {
        throw new RestoreAccountError(RESTORE_CODES[error.reason] ?? 'network', error);
      }
      // A missing function (BackendUnavailableError) goes to the screen's degrade rule.
      if (error instanceof BackendUnavailableError) throw error;
      throw new RestoreAccountError('network', error);
    }
  }
}
