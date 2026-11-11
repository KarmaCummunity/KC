// Translates Postgres error responses from `posts` INSERT into typed
// PostError instances. Kept separate from SupabasePostRepository so the
// repository file stays under its size cap (TD-50) and the mapping is
// independently unit-testable.

import { PostError, type PostErrorCode } from '@kc/application';

interface PostgresErrorShape {
  readonly code?: string;
  readonly message?: string;
  readonly details?: string;
}

function detailOf(err: unknown): string {
  const pg = (err ?? {}) as PostgresErrorShape;
  return `${pg.message ?? ''} ${pg.details ?? ''}`.toLowerCase();
}

// Postgres error codes:
//   23502 not_null_violation       → required column missing
//   23503 foreign_key_violation    → city_id not in cities (city_not_found) / other FK
//   23514 check_violation          → street_number regex / posts_type_fields_chk / active cap /
//                                    offer_photo_required (D132, 0741) / …
//   42501 insufficient_privilege   → RLS policy denied (incl. FollowersOnly without Private profile)
export function mapInsertError(err: unknown): PostError {
  const pg = (err ?? {}) as PostgresErrorShape;
  const pgCode = pg.code ?? '';
  const detail = detailOf(err);
  let code: PostErrorCode = 'unknown';

  if (detail.includes('offer_photo_required')) {
    // D132 (migration 0741): an items offer needs a photo. Checked at commit, so it can
    // arrive from the create RPC; it reuses the client's existing copy for the same rule.
    code = 'image_required_for_give';
  } else if (
    detail.includes('active_post_limit_exceeded')
    || detail.includes('limit=20')
  ) {
    code = 'active_post_limit_exceeded';
  } else if (pgCode === '23503') {
    if (detail.includes('city')) code = 'city_not_found';
    else if (detail.includes('owner')) code = 'forbidden';
    else code = 'address_invalid';
  } else if (pgCode === '23514') {
    if (detail.includes('street_number')) code = 'street_number_invalid';
    else if (detail.includes('type_fields')) code = 'invalid_post_type';
    else if (detail.includes('item_condition')) code = 'condition_required_for_give';
    else if (detail.includes('street')) code = 'address_required';
    else code = 'address_invalid';
  } else if (pgCode === '23502') {
    code = detail.includes('title') ? 'title_required' : 'address_required';
  } else if (pgCode === '42501') {
    code = 'followers_only_requires_private';
  }

  return new PostError(code, `create.post: ${pg.message ?? pgCode}`, err);
}
