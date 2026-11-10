export type AccountGateReason =
  /** The phone or email is not verified yet. */
  | 'pending_verification'
  | 'banned'
  | 'suspended_admin'
  | 'suspended_for_false_reports'
  /** FR-AUTH-016 — the user deleted the account; it is restorable until `until` (the purge date). */
  | 'pending_deletion';

export interface AccountGateResult {
  readonly allowed: boolean;
  readonly reason?: AccountGateReason;
  readonly until?: string;  // ISO timestamp
}

export interface IAccountGateRepository {
  checkAccountGate(userId: string): Promise<AccountGateResult>;
  /** FR-AUTH-016 — brings the signed-in user's account back during its 30-day grace period. */
  restoreAccount(): Promise<void>;
}
