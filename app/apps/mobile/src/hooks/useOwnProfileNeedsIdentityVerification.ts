// FR-VERIFY-003 AC1 — profile reminder until ID verification (level 2).
import { effectiveVerificationLevel, type User } from '@kc/domain';
import { isOwnProfileIncomplete } from './useOwnProfileIncomplete';

/** True when the owner may verify identity: profile is complete (≥ effective level 1) but not level 2. */
export function needsIdentityVerificationReminder(user: User | null | undefined): boolean {
  if (!user) return false;
  if (isOwnProfileIncomplete(user)) return false;
  return effectiveVerificationLevel(user) < 2;
}
