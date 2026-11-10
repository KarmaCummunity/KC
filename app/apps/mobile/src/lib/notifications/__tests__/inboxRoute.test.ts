// KC#869 / TD-102 — an inbox row opens the screen its kind allows, with checked ids; the stored
// data.route is never navigated to as-is.
import { describe, expect, it } from 'vitest';
import { resolveInboxRoute } from '../inboxRoute';

const POST = '22222222-2222-4222-8222-222222222222';
const LISTING = '11111111-1111-4111-8111-111111111111';

describe('resolveInboxRoute', () => {
  it('opens an event notice on its post even though the payload names the param postId', () => {
    expect(
      resolveInboxRoute('event_registration_cancelled', { route: '/post/[id]', params: { postId: POST } }),
    ).toEqual({ pathname: '/post/[id]', params: { id: POST } });
  });

  it('opens a comment on its post', () => {
    expect(resolveInboxRoute('post_comment', { route: '/post/[id]', params: { id: POST } }))
      .toEqual({ pathname: '/post/[id]', params: { id: POST } });
  });

  it('reads the top-level listing id of a match notice', () => {
    expect(resolveInboxRoute('listing_match_found', { listing_id: LISTING, candidate_listing_id: POST }))
      .toEqual({ pathname: '/listing/[listingId]', params: { listingId: LISTING } });
  });

  it('never follows a route an unknown kind carries', () => {
    expect(resolveInboxRoute('attacker_kind', { route: '/(admin)/anything' })).toBeNull();
  });

  it('ignores params that are not plain strings', () => {
    expect(resolveInboxRoute('post_comment', { params: { id: 42 } })).toBeNull();
  });
});
