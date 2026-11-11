// A failed post call → the error the post flows understand.
//
// A baseline RPC refuses with a stable snake_case reason (`BackendRuleError.reason`); a direct write to
// `posts` is refused by a constraint or a row-level-security policy (a plain error whose `cause` is the
// PostgREST error). Both become a `PostError` with one of the codes the screens already have copy for.
// A missing backend object (`BackendUnavailableError`) and an unknown failure pass through unchanged.

import { PostError, type PostErrorCode } from '@kc/application';
import { BackendRuleError, DomainError } from '@kc/domain';

const CODE_BY_REASON: Readonly<Record<string, PostErrorCode>> = {
  closure_wrong_status: 'closure_wrong_status',
  closure_recipient_not_in_chat: 'closure_recipient_not_in_chat',
  reopen_window_expired: 'reopen_window_expired',
  // The owner actions share one message: the post is in a state that does not allow the move.
  listing_wrong_status: 'closure_wrong_status',
  listing_has_active_handoff: 'closure_wrong_status',
  world_not_assignable: 'closure_wrong_status',
  not_recipient_or_wrong_status: 'closure_wrong_status',
  offer_photo_required: 'image_required_for_give',
  post_limit_exceeded: 'active_post_limit_exceeded',
  post_not_found: 'not_found',
  comment_not_found: 'not_found',
  account_not_active: 'forbidden',
  unauthenticated: 'forbidden',
  not_participant: 'forbidden',
  followers_only_requires_public_profile: 'invalid_visibility',
  invalid_surface_visibility: 'invalid_visibility',
  invalid_identity_visibility: 'invalid_visibility',
};

/** The PostgREST error a refused write wraps (`Error.cause`). */
interface PostgrestCause {
  readonly code?: string;
  readonly message?: string;
  readonly details?: string;
}

/** Constraint of `posts` that a title / description / city can break, by SQLSTATE and constraint text. */
function codeOfPostgrestError(cause: PostgrestCause): PostErrorCode | null {
  const text = `${cause.message ?? ''} ${cause.details ?? ''}`.toLowerCase();
  if (cause.code === '23503' && text.includes('city')) return 'city_not_found';
  if (cause.code === '23514' && text.includes('title')) return 'title_too_long';
  if (cause.code === '23514' && text.includes('description')) return 'description_too_long';
  if (cause.code === '23514' && text.includes('street_number')) return 'street_number_invalid';
  if (cause.code === '23502' && text.includes('title')) return 'title_required';
  if (cause.code === '42501') return 'forbidden';
  return null;
}

/** The `PostError` for `error`, or `error` itself when it is not one this module classifies. */
export function toPostError(error: unknown): unknown {
  if (error instanceof BackendRuleError) {
    return new PostError(CODE_BY_REASON[error.reason] ?? 'unknown', error.reason, error);
  }
  if (error instanceof DomainError) return error;
  const cause = (error as { cause?: PostgrestCause } | null)?.cause;
  const code = cause ? codeOfPostgrestError(cause) : null;
  return code ? new PostError(code, error instanceof Error ? error.message : code, error) : error;
}
