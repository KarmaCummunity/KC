// Stable RPC refusal → typed FollowError. The reasons are the messages `follow_user`,
// `follow_request_decide` and `follow_request_cancel` raise (15_social_graph/040_follow_rpcs.sql).

import { FollowError, type FollowErrorCode } from '@kc/application';
import { BackendRuleError } from '@kc/domain';

const CODE_BY_REASON: Readonly<Record<string, FollowErrorCode>> = {
  self_follow_forbidden: 'self_follow',
  blocked_relationship: 'blocked_relationship',
  follow_request_cooldown_active: 'cooldown_active',
  account_not_active: 'account_not_active',
  rate_limited: 'rate_limited',
  user_unavailable: 'user_not_found',
};

/** `cooldown_until=<ISO>` in the detail of a cooldown refusal. */
const COOLDOWN_DETAIL = /cooldown_until=([0-9TZ:.+-]+)/;

/** The detail text of the PostgREST error a rule refusal wraps (`BackendRuleError.cause`). */
function detailOf(error: BackendRuleError): string {
  const cause = error.cause as { details?: unknown } | undefined;
  return typeof cause?.details === 'string' ? cause.details : '';
}

/** The FollowError for a stable refusal; `unknown` for a refusal the follow flow has no code for. */
export function mapFollowError(error: BackendRuleError): FollowError {
  const code = CODE_BY_REASON[error.reason] ?? 'unknown';
  const cooldownUntil = code === 'cooldown_active' ? COOLDOWN_DETAIL.exec(detailOf(error))?.[1] : undefined;
  return new FollowError(code, error.reason, { cause: error, cooldownUntil });
}
