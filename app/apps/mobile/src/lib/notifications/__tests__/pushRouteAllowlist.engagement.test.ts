// Push taps of the engagement, moderation and matching notices (FR-FEED, FR-MOD, match v1 and
// listing subscriptions): each opens its own screen and drops a malformed payload.
import { describe, it, expect } from 'vitest';
import { resolvePushRoute } from '../pushRouteAllowlist';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('resolvePushRoute — engagement, moderation and matching', () => {
  it.each(['post_reaction', 'post_comment', 'post_mention'] as const)('opens the post of %s', (kind) => {
    expect(resolvePushRoute({ category: 'social', kind, notification_id: 'n20', params: { id: UUID } }))
      .toEqual({ pathname: '/post/[id]', params: { id: UUID } });
    expect(resolvePushRoute({ category: 'social', kind, notification_id: 'n21', params: { id: 'nope' } })).toBeNull();
  });

  it('opens the blocked-account screen for a suspension and the audit trail for a removed chat', () => {
    expect(resolvePushRoute({ category: 'critical', kind: 'account_suspended', notification_id: 'n22' }))
      .toEqual({ pathname: '/account-blocked', params: {} });
    expect(resolvePushRoute({ category: 'critical', kind: 'chat_auto_removed', notification_id: 'n23' }))
      .toEqual({ pathname: '/settings/audit', params: {} });
  });

  it('opens the admin case of a late report, and nothing for a malformed route', () => {
    expect(resolvePushRoute({
      category: 'critical', kind: 'report_sla_warning', notification_id: 'n24', route: `/(admin)/reports/post%3A${UUID}`,
    })).toEqual({ pathname: '/(admin)/reports/[caseId]', params: { caseId: `post:${UUID}` } });
    expect(resolvePushRoute({
      category: 'critical', kind: 'report_sla_warning', notification_id: 'n25', route: '/(admin)/reports/post%3Ax/../y',
    })).toBeNull();
  });

  it('opens the listing of a match and the post of a listing subscription', () => {
    expect(resolvePushRoute({ category: 'social', kind: 'listing_match_found', notification_id: 'n26', listing_id: UUID }))
      .toEqual({ pathname: '/listing/[listingId]', params: { listingId: UUID } });
    expect(resolvePushRoute({ category: 'social', kind: 'listing_subscription_hit', notification_id: 'n27', listing_id: UUID }))
      .toEqual({ pathname: '/post/[id]', params: { id: UUID } });
  });
});
