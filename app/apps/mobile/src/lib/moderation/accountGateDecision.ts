// FR-MOD-010 / D33 / D61 — what the app does with an account-gate result.
// Suspended users stay signed in: they browse and can chat with support while
// the server blocks their actions. Banned users are signed out; accounts that
// still need verification go back to sign-in. FR-AUTH-016: an account its owner
// deleted stays signed in and is offered a restore until its purge date.
import type { AccountGateResult } from '@kc/application';

export type AccountGateDecision =
  | { action: 'allow' }
  | { action: 'suspended'; reason: string; until: string | null }
  | { action: 'reverify' }
  | { action: 'restore'; purgeAt: string | null }
  | { action: 'blocked'; reason: string; until: string | null };

const SUSPENDED_REASONS = new Set(['suspended_admin', 'suspended_for_false_reports']);

export function accountGateDecision(result: AccountGateResult): AccountGateDecision {
  if (result.allowed) return { action: 'allow' };
  // No reason means no account row (e.g. a purged account): treated as blocked.
  const reason = result.reason ?? 'banned';
  if (reason === 'pending_verification') return { action: 'reverify' };
  const until = result.until || null;
  if (reason === 'pending_deletion') return { action: 'restore', purgeAt: until };
  if (SUSPENDED_REASONS.has(reason)) return { action: 'suspended', reason, until };
  return { action: 'blocked', reason, until };
}
