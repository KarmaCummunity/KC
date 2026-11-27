// FR-VERIFY-003 AC1 — profile reminder until ID verification. Hidden while complete
// profile is the live maximum (#1037); restore when Didit IDV launches.
import { effectiveVerificationLevel, isAtMaxLiveVerificationLevel, type User } from '@kc/domain';
import { isOwnProfileIncomplete } from './useOwnProfileIncomplete';

/** True when the owner should see an ID-verification nudge (never while max live = complete profile). */
export function needsIdentityVerificationReminder(user: User | null | undefined): boolean {
  if (!user) return false;
  if (isOwnProfileIncomplete(user)) return false;
  const level = effectiveVerificationLevel(user);
  if (isAtMaxLiveVerificationLevel(level)) return false;
  return level < 2;
}
